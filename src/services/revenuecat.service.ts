import { z } from "zod";
import { env } from "../env";
import { BillingSyncUnavailableError, UpstreamError } from "../lib/errors";
import { logger } from "../lib/logger";
import { metric } from "../lib/metrics";
import { subscriptionRepo, userRepo } from "../repositories";
import type { User } from "../repositories/user.repository";
import { persistSubscriptionAndMirror, getSubscriptionState } from "./subscription.service";

const subscriberSchema = z
  .object({
    entitlements: z
      .record(
        z.string(),
        z
          .object({
            product_identifier: z.string().nullish(),
            expires_date: z.string().nullish(),
            purchase_date: z.string().nullish(),
          })
          .passthrough()
      )
      .default({}),
    subscriptions: z
      .record(
        z.string(),
        z
          .object({
            product_identifier: z.string().nullish(),
            period_type: z.string().nullish(),
            store: z.string().nullish(),
            purchase_date: z.string().nullish(),
            expires_date: z.string().nullish(),
            unsubscribe_detected_at: z.string().nullish(),
            billing_issues_detected_at: z.string().nullish(),
            grace_period_expires_date: z.string().nullish(),
          })
          .passthrough()
      )
      .default({}),
  })
  .passthrough();

type Subscriber = z.infer<typeof subscriberSchema>;

const revenueCatEnvelopeSchema = z.object({
  request_date_ms: z.union([z.number(), z.string()]),
  subscriber: subscriberSchema,
});

type RevenueCatCatalog = {
  app_store: { monthly: string; annual: string };
  play_store: { monthly: string; annual: string };
};

function dateOrNull(
  value: string | null | undefined,
  field: string,
  allowNull = true
): Date | null {
  if (value === null || value === undefined || value === "") {
    if (!allowNull) throw new BillingSyncUnavailableError(`RevenueCat field ${field} is missing`);
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BillingSyncUnavailableError(`RevenueCat field ${field} is invalid`);
  }
  return date;
}

function timestampMs(value: number | string, field: string): Date {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || !Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new BillingSyncUnavailableError(`RevenueCat field ${field} is invalid`);
  }
  const date = new Date(numeric);
  if (Number.isNaN(date.getTime())) {
    throw new BillingSyncUnavailableError(`RevenueCat field ${field} is invalid`);
  }
  return date;
}

function providerForStore(store: string | null | undefined): "app_store" | "play_store" {
  if (store === "APP_STORE") return "app_store";
  if (store === "PLAY_STORE") return "play_store";
  throw new BillingSyncUnavailableError("RevenueCat returned an unsupported store");
}

function parseCatalog(): RevenueCatCatalog {
  let parsed: unknown;
  try {
    parsed = JSON.parse(env.REVENUECAT_PRODUCT_CATALOG);
  } catch {
    throw new BillingSyncUnavailableError("RevenueCat product catalog is invalid");
  }
  const catalog = parsed as Partial<RevenueCatCatalog> | null;
  if (
    !catalog ||
    typeof catalog !== "object" ||
    !catalog.app_store ||
    !catalog.play_store ||
    typeof catalog.app_store.monthly !== "string" ||
    typeof catalog.app_store.annual !== "string" ||
    typeof catalog.play_store.monthly !== "string" ||
    typeof catalog.play_store.annual !== "string"
  ) {
    throw new BillingSyncUnavailableError("RevenueCat product catalog is incomplete");
  }
  return catalog as RevenueCatCatalog;
}

function mapStatus(
  product: Subscriber["subscriptions"][string],
  entitlement: Subscriber["entitlements"][string],
  expiration: Date,
  now: Date
): "trialing" | "active" | "canceled" | "in_grace" | "expired" {
  if (expiration <= now) return "expired";
  if (product.billing_issues_detected_at) return "in_grace";
  if (product.unsubscribe_detected_at) return "canceled";
  if (product.period_type === "TRIAL") return "trialing";
  return "active";
}

async function fetchSubscriber(appUserId: string): Promise<Subscriber> {
  if (env.BILLING_PROVIDER !== "revenuecat" || !env.REVENUECAT_SECRET_API_KEY) {
    throw new BillingSyncUnavailableError("RevenueCat billing is not configured");
  }
  let response: Response;
  try {
    response = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
      {
        signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: `Bearer ${env.REVENUECAT_SECRET_API_KEY}`,
          Accept: "application/json",
        },
      }
    );
  } catch (error) {
    throw new BillingSyncUnavailableError("RevenueCat could not be reached", {
      cause: String(error),
    });
  }
  if (!response.ok) {
    throw new BillingSyncUnavailableError(
      `RevenueCat subscriber lookup failed (${response.status})`
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new BillingSyncUnavailableError("RevenueCat returned an invalid subscriber payload");
  }
  const parsed = revenueCatEnvelopeSchema.safeParse(body);
  if (!parsed.success) {
    throw new BillingSyncUnavailableError("RevenueCat returned an invalid subscriber payload");
  }
  return {
    ...parsed.data.subscriber,
    request_date_ms: parsed.data.request_date_ms,
  } as Subscriber & { request_date_ms: number | string };
}

/** Reconcile a valid RevenueCat snapshot into the backend projection. */
export async function syncRevenueCatSubscription(user: User, now = new Date()) {
  if (env.BILLING_PROVIDER !== "revenuecat") return getSubscriptionState(user, now);
  const startedAt = Date.now();
  const subscriber = await fetchSubscriber(user.id);
  const catalog = parseCatalog();
  if (!env.REVENUECAT_ENTITLEMENT_ID) {
    throw new BillingSyncUnavailableError("RevenueCat entitlement is not configured");
  }
  const entitlement = subscriber.entitlements[env.REVENUECAT_ENTITLEMENT_ID];
  const observedAt = timestampMs(
    (subscriber as Subscriber & { request_date_ms: number | string }).request_date_ms,
    "request_date_ms"
  );

  // A successful, valid snapshot with no premium entitlement is authoritative:
  // it revokes the local projection instead of leaving stale premium access.
  // Transport errors and invalid payloads throw before this point and therefore
  // leave the existing projection untouched.
  if (!entitlement) {
    logger.info({ userId: user.id }, "RevenueCat snapshot has no premium entitlement");
    metric("billing.sync.no_entitlement_downgrade", 1, { userId: user.id });
    const existing = await subscriptionRepo.getByUser(user.id);
    await persistSubscriptionAndMirror(user.id, {
      userId: user.id,
      rcAppUserId: user.id,
      provider: existing?.provider ?? "app_store",
      productId: null,
      status: "none",
      trialEnd: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      lastEventAt: observedAt,
      lastSyncedAt: observedAt,
    });
    const updated = (await userRepo.findById(user.id)) ?? user;
    return getSubscriptionState(updated, now);
  }
  const productId = entitlement?.product_identifier ?? null;
  const product = productId ? subscriber.subscriptions[productId] : undefined;
  if (!productId || !product) {
    throw new BillingSyncUnavailableError("RevenueCat returned an incomplete premium entitlement");
  }

  const provider = providerForStore(product.store);
  const catalogProducts = catalog[provider];
  if (![catalogProducts.monthly, catalogProducts.annual].includes(productId)) {
    throw new BillingSyncUnavailableError("RevenueCat returned an unconfigured product");
  }
  if (
    !product.period_type ||
    !["TRIAL", "INTRO", "NORMAL", "PROMOTIONAL", "PREPAID"].includes(product.period_type)
  ) {
    throw new BillingSyncUnavailableError("RevenueCat returned an unsupported period type");
  }
  if (product.product_identifier && product.product_identifier !== productId) {
    throw new BillingSyncUnavailableError("RevenueCat product identifiers do not match");
  }
  const expiration = dateOrNull(
    entitlement.expires_date ?? product.expires_date,
    "expires_date",
    false
  )!;
  const purchasedAt = dateOrNull(
    entitlement.purchase_date ?? product.purchase_date,
    "purchase_date",
    false
  )!;
  dateOrNull(product.unsubscribe_detected_at, "unsubscribe_detected_at");
  dateOrNull(product.billing_issues_detected_at, "billing_issues_detected_at");
  const status = mapStatus(product, entitlement, expiration, now);

  await persistSubscriptionAndMirror(user.id, {
    userId: user.id,
    rcAppUserId: user.id,
    provider,
    productId,
    status,
    trialEnd: status === "trialing" ? expiration : user.trialEndsAt,
    currentPeriodStart: purchasedAt,
    currentPeriodEnd: expiration,
    cancelAtPeriodEnd: status === "canceled",
    lastEventAt: observedAt,
    lastSyncedAt: observedAt,
  });
  metric("billing.sync.success", 1, {
    userId: user.id,
    status,
    latencyMs: Date.now() - startedAt,
  });

  const updated = (await userRepo.findById(user.id)) ?? user;
  return getSubscriptionState(updated, now);
}

export async function deleteRevenueCatCustomer(appUserId: string): Promise<void> {
  if (env.BILLING_PROVIDER !== "revenuecat") return;
  if (!env.REVENUECAT_SECRET_API_KEY) {
    throw new BillingSyncUnavailableError("RevenueCat customer deletion is not configured");
  }
  let response: Response;
  try {
    response = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
      {
        method: "DELETE",
        signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${env.REVENUECAT_SECRET_API_KEY}` },
      }
    );
  } catch (error) {
    throw new UpstreamError("RevenueCat customer deletion could not be reached", error);
  }
  if (!response.ok && response.status !== 404) {
    throw new UpstreamError(`RevenueCat customer deletion failed (${response.status})`);
  }
}

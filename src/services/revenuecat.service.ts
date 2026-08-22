import { z } from "zod";
import { env } from "../env";
import { UpstreamError } from "../lib/errors";
import { userRepo } from "../repositories";
import type { User } from "../repositories/user.repository";
import { persistSubscriptionAndMirror, getSubscriptionState } from "./subscription.service";

const subscriberSchema = z
  .object({
    request_date_ms: z.number().nullish(),
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
          })
          .passthrough()
      )
      .default({}),
  })
  .passthrough();

type Subscriber = z.infer<typeof subscriberSchema>;

function dateOrNull(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function providerForStore(store: string | null | undefined): "app_store" | "play_store" | "stripe" {
  return store === "PLAY_STORE" ? "play_store" : store === "STRIPE" ? "stripe" : "app_store";
}

function isExpired(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && expiresAt <= now;
}

function mapStatus(
  product: Subscriber["subscriptions"][string],
  entitlement: Subscriber["entitlements"][string],
  now: Date
): "trialing" | "active" | "canceled" | "in_grace" | "expired" {
  const expiresAt = dateOrNull(entitlement.expires_date ?? product.expires_date);
  if (isExpired(expiresAt, now)) return "expired";
  if (product.period_type === "TRIAL") return "trialing";
  if (product.billing_issues_detected_at) return "in_grace";
  if (product.unsubscribe_detected_at) return "canceled";
  return "active";
}

async function fetchSubscriber(appUserId: string): Promise<Subscriber> {
  if (env.BILLING_PROVIDER !== "revenuecat" || !env.REVENUECAT_SECRET_API_KEY) {
    throw new UpstreamError("RevenueCat billing is not configured");
  }
  let response: Response;
  try {
    response = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
      {
        headers: {
          Authorization: `Bearer ${env.REVENUECAT_SECRET_API_KEY}`,
          Accept: "application/json",
        },
      }
    );
  } catch (error) {
    throw new UpstreamError("RevenueCat could not be reached", error);
  }
  if (!response.ok) {
    throw new UpstreamError(`RevenueCat subscriber lookup failed (${response.status})`);
  }
  const body = (await response.json()) as { subscriber?: unknown };
  const parsed = subscriberSchema.safeParse(body.subscriber ?? body);
  if (!parsed.success) throw new UpstreamError("RevenueCat returned an invalid subscriber payload");
  return parsed.data;
}

/**
 * Reconcile the current RevenueCat snapshot into the backend projection. A
 * missing entitlement never downgrades a just-purchased local projection: the
 * next webhook/sync will provide the authoritative state once the store settles.
 */
export async function syncRevenueCatSubscription(user: User, now = new Date()) {
  if (env.BILLING_PROVIDER !== "revenuecat") return getSubscriptionState(user, now);

  const subscriber = await fetchSubscriber(user.id);
  const entitlement = subscriber.entitlements[env.REVENUECAT_ENTITLEMENT_ID];
  const productId = entitlement?.product_identifier ?? null;
  const product = productId ? subscriber.subscriptions[productId] : undefined;
  if (!entitlement || !product) return getSubscriptionState(user, now);

  const expiration = dateOrNull(entitlement.expires_date ?? product.expires_date);
  const purchasedAt = dateOrNull(entitlement.purchase_date ?? product.purchase_date);
  const observedAt = subscriber.request_date_ms
    ? new Date(subscriber.request_date_ms)
    : new Date(now);
  const status = mapStatus(product, entitlement, now);

  await persistSubscriptionAndMirror(user.id, {
    userId: user.id,
    rcAppUserId: user.id,
    provider: providerForStore(product.store),
    productId,
    status,
    trialEnd: status === "trialing" ? expiration : user.trialEndsAt,
    currentPeriodStart: purchasedAt,
    currentPeriodEnd: expiration,
    cancelAtPeriodEnd: status === "canceled",
    lastEventAt: observedAt,
    lastSyncedAt: observedAt,
  });

  const updated = (await userRepo.findById(user.id)) ?? user;
  return getSubscriptionState(updated, now);
}

export async function deleteRevenueCatCustomer(appUserId: string): Promise<void> {
  if (env.BILLING_PROVIDER !== "revenuecat" || !env.REVENUECAT_SECRET_API_KEY) return;
  let response: Response;
  try {
    response = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
      {
        method: "DELETE",
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

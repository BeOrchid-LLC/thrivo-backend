import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "../env";
import { logger } from "../lib/logger";
import { ForbiddenError, ValidationError } from "../lib/errors";
import {
  accountErasureRepo,
  subscriptionRepo,
  subscriptionEventRepo,
  userRepo,
  webhookEventRepo,
  webhookIdentityOwnershipRepo,
} from "../repositories";
import type { SubProvider, SubscriptionEventType, SubStatus } from "../../db/schema";
import { persistSubscriptionAndMirror } from "./subscription.service";
import { queueTemplatedEmail } from "./email.service";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { emailAppLink } from "../lib/email/links";
import { enqueue, QUEUE_NAMES } from "../lib/queue";

function identityDigest(value: string): string {
  return createHmac("sha256", env.AUTH_SECRET).update(value).digest("hex");
}

/**
 * RevenueCat v1 webhook envelope — only the fields we consume. Unknown fields are
 * ignored; the model is treated as untrusted input and validated at the edge.
 */
const revenueCatEventSchema = z.object({
  event: z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    app_user_id: z.string().min(1),
    original_app_user_id: z.string().min(1),
    aliases: z.array(z.string().min(1)).default([]),
    product_id: z.string().min(1).nullish(),
    period_type: z.string().min(1).nullish(), // NORMAL | TRIAL | INTRO
    store: z.string().min(1).nullish(), // APP_STORE | PLAY_STORE | STRIPE | ...
    purchased_at_ms: z.union([z.number(), z.string()]).nullish(),
    expiration_at_ms: z.union([z.number(), z.string()]).nullish(),
    event_timestamp_ms: z.union([z.number(), z.string()]).nullish(),
    cancel_reason: z.string().nullish(),
    expiration_reason: z.string().nullish(),
    // Price in the purchase currency — null/0 (free trial)/negative (refund)
    // are all valid per RevenueCat's docs. Used to populate subscription_events'
    // priceAmountCents/currency (revenue-to-date, first charge) going forward.
    price_in_purchased_currency: z.number().nullish(),
    currency: z.string().nullish(),
  }),
});

export type RevenueCatWebhookOutcome = "processed" | "ignored" | "duplicate" | "quarantined";

function eventDate(value: number | string | null | undefined, field = "event_timestamp_ms"): Date {
  if (value === null || value === undefined || value === "") {
    throw new ValidationError(`RevenueCat ${field} is required`);
  }
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || !Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new ValidationError(`RevenueCat ${field} is invalid`);
  }
  const parsed = new Date(numeric);
  if (Number.isNaN(parsed.getTime())) throw new ValidationError(`RevenueCat ${field} is invalid`);
  return parsed;
}

function lifecycleFieldsValid(event: z.infer<typeof revenueCatEventSchema>["event"]): void {
  const lifecycle = new Set([
    "INITIAL_PURCHASE",
    "RENEWAL",
    "CANCELLATION",
    "EXPIRATION",
    "BILLING_ISSUE",
    "UNCANCELLATION",
    "PRODUCT_CHANGE",
    "REFUND",
    "REFUND_REVERSED",
    "SUBSCRIPTION_PAUSED",
    "SUBSCRIPTION_EXTENDED",
    "TRANSFER",
  ]);
  if (!lifecycle.has(event.type)) return;
  if (
    !event.original_app_user_id ||
    !event.product_id ||
    !event.period_type ||
    !event.store ||
    event.purchased_at_ms == null
  ) {
    throw new ValidationError("RevenueCat lifecycle event is missing mandatory fields");
  }
  if (!["APP_STORE", "PLAY_STORE", "STRIPE"].includes(event.store)) {
    throw new ValidationError("RevenueCat store is not supported");
  }
  eventDate(event.event_timestamp_ms);
  eventDate(event.purchased_at_ms, "purchased_at_ms");
  if (event.expiration_at_ms == null)
    throw new ValidationError("RevenueCat expiration_at_ms is required for Thrivo subscriptions");
  eventDate(event.expiration_at_ms, "expiration_at_ms");
}

/**
 * Constant-time compare of a webhook Authorization header against the configured
 * shared secret. An unset secret ⇒ reject everything (fail closed) so a missing
 * env var can never silently accept unauthenticated events. Pure + exported for
 * unit testing.
 */
export function signatureMatches(header: string | undefined, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isAuthorized(header: string | undefined): boolean {
  return signatureMatches(header, env.REVENUECAT_WEBHOOK_AUTH);
}

/**
 * A5-5: confirmation that a cancellation was received. Fired only for the
 * CANCELLATION event itself (auto-renew turned off), not for EXPIRATION —
 * the user already saw the cancel flow in-app/in-store; this just confirms it
 * landed, per the "honest, no-surprises" brand promise (~60s of the action).
 */
async function sendCancellationEmail(
  email: string,
  userId: string,
  subscriptionId: string,
  effectiveEnd: Date | null,
  transaction: Executor
): Promise<void> {
  await queueTemplatedEmail({
    kind: "cancellation_confirmation",
    to: email,
    userId,
    resendable: true,
    dedupeKey: `cancellation:${subscriptionId}:${effectiveEnd?.toISOString() ?? "unknown"}`,
    expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    transaction,
    template: "notification",
    props: {
      title: "Your Thrivo cancellation is confirmed",
      body: "Auto-renew is off. You'll keep premium access until the end of your current billing period, then move to the free plan automatically — no further charges.",
      cta: { label: "Manage subscription", url: emailAppLink("subscription") },
    },
  });
}

export function mapStore(store: string | null | undefined): SubProvider {
  if (store === "PLAY_STORE") return "play_store";
  if (store === "STRIPE") return "stripe";
  return "app_store";
}

/** Map a RevenueCat event type to our subscription status, or null to ack-and-ignore. */
export function mapStatus(
  type: string,
  periodType: string | null | undefined,
  cancelReason?: string | null
): SubStatus | null {
  switch (type) {
    case "INITIAL_PURCHASE":
    case "RENEWAL":
    case "UNCANCELLATION":
    case "PRODUCT_CHANGE":
      return periodType === "TRIAL" ? "trialing" : "active";
    case "CANCELLATION":
      return cancelReason === "BILLING_ERROR" ? "in_grace" : "canceled";
    case "EXPIRATION":
      return "expired";
    case "BILLING_ISSUE":
      return "in_grace";
    default:
      return null; // TRANSFER, SUBSCRIBER_ALIAS, TEST, etc. — recorded, not applied
  }
}

/**
 * Classify a RevenueCat event into a `subscription_events` row type, or `null`
 * if it's not part of the trial funnel (e.g. a non-trial CANCELLATION, or a
 * BILLING_ISSUE). `previousStatus` is the subscription's status *before* this
 * event was applied — required to tell a fresh RENEWAL apart from a trial
 * converting, and a trial CANCELLATION apart from a regular one.
 */
/**
 * Convert RevenueCat's `price_in_purchased_currency` (float, purchase
 * currency) to integer cents. Null/non-number stays null — never fabricated
 * as 0 — since RevenueCat itself sends null for "unknown" (distinct from an
 * actual $0 free-trial event, which arrives as the number 0).
 */
export function extractPriceFields(event: {
  price_in_purchased_currency?: number | null;
  currency?: string | null;
}): { priceAmountCents: number | null; currency: string | null } {
  const priceAmountCents =
    typeof event.price_in_purchased_currency === "number"
      ? Math.round(event.price_in_purchased_currency * 100)
      : null;
  const normalizedCurrency =
    typeof event.currency === "string" && /^[A-Za-z]{3}$/.test(event.currency.trim())
      ? event.currency.trim().toUpperCase()
      : null;
  return { priceAmountCents, currency: normalizedCurrency };
}

export function classifySubscriptionEvent(
  type: string,
  periodType: string | null | undefined,
  previousStatus: SubStatus | null
): SubscriptionEventType | null {
  if (type === "INITIAL_PURCHASE" && periodType === "TRIAL") return "trial_started";
  if (type === "EXPIRATION") return "expired";
  if (type === "CANCELLATION")
    return previousStatus === "trialing" ? "trial_cancelled" : "canceled";
  if (type === "RENEWAL" || type === "PRODUCT_CHANGE" || type === "UNCANCELLATION") {
    if (previousStatus === "trialing" && periodType !== "TRIAL") return "trial_converted";
    if (type === "RENEWAL" && previousStatus !== "trialing") return "renewed";
    if (type === "PRODUCT_CHANGE") return "product_changed";
  }
  if (type === "BILLING_ISSUE") return "billing_issue";
  if (type === "REFUND") return "refunded";
  if (type === "REFUND_REVERSED") return "refund_reversed";
  if (type === "SUBSCRIPTION_EXTENDED") return "subscription_extended";
  return null;
}

/**
 * Process an inbound RevenueCat webhook. Idempotent and ordering-safe:
 * - the (provider, event_id) ledger dedupes retries (same event applied twice);
 * - the monotonic-by-event-time guard lives inside `persistSubscriptionAndMirror`'s
 *   conditional write, not a pre-check here, so a replayed or out-of-order event
 *   can never revert a newer entitlement state — even under concurrent delivery;
 * - entitlement is written through the one subscription writer.
 *
 * Throws ForbiddenError on a bad/absent signature (caller maps to 401/403).
 */
export async function handleRevenueCatWebhook(
  authHeader: string | undefined,
  body: unknown
): Promise<RevenueCatWebhookOutcome> {
  if (!env.REVENUECAT_WEBHOOK_AUTH) {
    // Not the caller's fault — the server is unconfigured. Fail closed, but log
    // the missing var so an operator knows why every webhook is being rejected.
    logger.error(
      "REVENUECAT_WEBHOOK_AUTH is not set; rejecting webhook (entitlements will not sync)"
    );
    throw new ForbiddenError("Webhook receiver is not configured");
  }
  if (!isAuthorized(authHeader)) {
    throw new ForbiddenError("Invalid webhook signature");
  }

  const { event } = revenueCatEventSchema.parse(body);
  lifecycleFieldsValid(event);
  const identityValues = [event.app_user_id, event.original_app_user_id, ...event.aliases].filter(
    (id): id is string => Boolean(id)
  );
  const identityDigests = identityValues.map(identityDigest);

  // Ledger: record-or-find. A row already marked "processed" is a true replay.
  let ledger = await webhookEventRepo.recordReceived({
    provider: "revenuecat",
    eventId: event.id,
    payload: body as object,
  });
  if (!ledger) {
    const existing = await webhookEventRepo.findByProviderEvent("revenuecat", event.id);
    if (existing?.status === "processed") return "duplicate";
    ledger = existing; // a stuck "received"/"failed" row — reprocess it
  }
  if (!ledger) return "duplicate";

  await webhookIdentityOwnershipRepo.recordMany(ledger.id, identityDigests);

  try {
    // A tombstoned identity always wins over a live alias. This prevents a
    // recreated RevenueCat customer from restoring a deleted account.
    const tombstoned = await Promise.all(
      identityDigests.map((digest) => accountErasureRepo.hasActiveTombstone("revenuecat", digest))
    );
    if (tombstoned.some(Boolean)) {
      const expiry =
        event.expiration_at_ms != null
          ? new Date(
              eventDate(event.expiration_at_ms, "expiration_at_ms").getTime() +
                365 * 24 * 60 * 60 * 1000
            )
          : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      for (const digest of identityDigests) {
        await accountErasureRepo.extendTombstone("revenuecat", digest, expiry);
      }
      await webhookEventRepo.redactById(ledger.id);
      await enqueue(
        QUEUE_NAMES.maintenance,
        "delete-revenuecat-customer",
        { appUserIds: identityValues },
        { attempts: 8, backoff: { type: "exponential", delay: 60_000 }, removeOnComplete: true }
      );
      await webhookEventRepo.markProcessed(ledger.id, "processed");
      return "ignored";
    }
    const status = mapStatus(event.type, event.period_type, event.cancel_reason);
    if (!status) {
      await webhookEventRepo.markProcessed(ledger.id, "processed");
      return "ignored";
    }

    const userCandidates = await userRepo.findByIds([
      event.app_user_id,
      event.original_app_user_id ?? "",
      ...event.aliases,
    ]);
    if (userCandidates.length !== 1) {
      logger.error(
        {
          appUserId: event.app_user_id,
          originalAppUserId: event.original_app_user_id,
          aliases: event.aliases,
          candidates: userCandidates.length,
          type: event.type,
        },
        userCandidates.length === 0
          ? "revenuecat webhook for unknown app_user_id"
          : "revenuecat webhook matched multiple users"
      );
      await webhookEventRepo.markProcessed(ledger.id, "quarantined");
      return "quarantined";
    }
    const user = userCandidates[0]!;
    await webhookIdentityOwnershipRepo.recordMany(ledger.id, identityDigests, user.id);

    const eventAt = eventDate(event.event_timestamp_ms);
    const periodEnd =
      event.expiration_at_ms != null ? eventDate(event.expiration_at_ms, "expiration_at_ms") : null;
    if (
      [
        "TRANSFER",
        "PRODUCT_CHANGE",
        "REFUND",
        "REFUND_REVERSED",
        "SUBSCRIPTION_PAUSED",
        "SUBSCRIPTION_EXTENDED",
      ].includes(event.type) ||
      (event.type === "CANCELLATION" && event.cancel_reason === "CUSTOMER_SUPPORT")
    ) {
      const historyType = classifySubscriptionEvent(event.type, event.period_type, null);
      if (historyType) {
        await db.transaction(async (tx) => {
          await subscriptionEventRepo.insert(
            {
              userId: user.id,
              eventType: historyType,
              productId: event.product_id ?? null,
              occurredAt: eventAt,
              rawEventId: ledger.id,
              ...extractPriceFields(event),
            },
            tx
          );
          await webhookEventRepo.markProcessed(ledger.id, "processed", tx);
        });
      } else {
        await webhookEventRepo.markProcessed(ledger.id, "processed");
      }
      await enqueue(
        QUEUE_NAMES.maintenance,
        "reconcile-subscriptions",
        { userId: user.id },
        { removeOnComplete: true }
      );
      return "processed";
    }
    const applied = await db.transaction(async (tx) => {
      const previousSub = await subscriptionRepo.getByUser(user.id, tx);
      const funnelEventType = classifySubscriptionEvent(
        event.type,
        event.period_type,
        previousSub?.status ?? null
      );
      const saved = await persistSubscriptionAndMirror(
        user.id,
        {
          userId: user.id,
          rcAppUserId: event.app_user_id,
          provider: mapStore(event.store),
          productId: event.product_id ?? null,
          status,
          trialEnd: status === "trialing" ? periodEnd : (user.trialEndsAt ?? null),
          currentPeriodStart: event.purchased_at_ms ? eventDate(event.purchased_at_ms) : null,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: status === "canceled",
          lastEventAt: eventAt,
          lastWebhookAt: eventAt,
        },
        funnelEventType
          ? {
              userId: user.id,
              eventType: funnelEventType,
              productId: event.product_id ?? null,
              occurredAt: eventAt,
              rawEventId: ledger.id,
              ...extractPriceFields(event),
            }
          : undefined,
        tx
      );
      if (saved && event.type === "CANCELLATION" && user.email) {
        await sendCancellationEmail(user.email, user.id, saved.id, saved.currentPeriodEnd, tx);
      }
      await webhookEventRepo.markProcessed(ledger.id, "processed", tx);
      return saved;
    });

    return applied ? "processed" : "ignored";
  } catch (err) {
    logger.error({ err, eventId: event.id, type: event.type }, "revenuecat webhook failed");
    await webhookEventRepo.markProcessed(ledger.id, "failed");
    throw err;
  }
}

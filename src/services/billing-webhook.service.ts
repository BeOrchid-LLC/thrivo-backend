import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "../env";
import { logger } from "../lib/logger";
import { ForbiddenError } from "../lib/errors";
import { subscriptionRepo, userRepo, webhookEventRepo } from "../repositories";
import type { SubProvider, SubscriptionEventType, SubStatus } from "../../db/schema";
import { persistSubscriptionAndMirror } from "./subscription.service";
import { sendTemplatedEmail } from "./email.service";

/**
 * RevenueCat v1 webhook envelope — only the fields we consume. Unknown fields are
 * ignored; the model is treated as untrusted input and validated at the edge.
 */
const revenueCatEventSchema = z.object({
  event: z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    app_user_id: z.string().min(1),
    product_id: z.string().nullish(),
    period_type: z.string().nullish(), // NORMAL | TRIAL | INTRO
    store: z.string().nullish(), // APP_STORE | PLAY_STORE | STRIPE | ...
    purchased_at_ms: z.number().nullish(),
    expiration_at_ms: z.number().nullish(),
    event_timestamp_ms: z.number().nullish(),
  }),
});

export type RevenueCatWebhookOutcome = "processed" | "ignored" | "duplicate";

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
async function sendCancellationEmail(email: string, userId: string): Promise<void> {
  await sendTemplatedEmail({
    to: email,
    userId,
    template: "notification",
    props: {
      title: "Your Thrivo cancellation is confirmed",
      body: "Auto-renew is off. You'll keep premium access until the end of your current billing period, then move to the free plan automatically — no further charges.",
      cta: { label: "Manage subscription", url: "https://thrivo.fit/app/subscription" },
    },
  });
}

export function mapStore(store: string | null | undefined): SubProvider {
  if (store === "PLAY_STORE") return "play_store";
  if (store === "STRIPE") return "stripe";
  return "app_store";
}

/** Map a RevenueCat event type to our subscription status, or null to ack-and-ignore. */
export function mapStatus(type: string, periodType: string | null | undefined): SubStatus | null {
  switch (type) {
    case "INITIAL_PURCHASE":
    case "RENEWAL":
    case "UNCANCELLATION":
    case "PRODUCT_CHANGE":
      return periodType === "TRIAL" ? "trialing" : "active";
    case "CANCELLATION":
      return "canceled"; // auto-renew off; access persists until current_period_end
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
export function classifySubscriptionEvent(
  type: string,
  periodType: string | null | undefined,
  previousStatus: SubStatus | null
): SubscriptionEventType | null {
  if (type === "INITIAL_PURCHASE" && periodType === "TRIAL") return "trial_started";
  if (type === "EXPIRATION") return "expired";
  if (type === "CANCELLATION") return previousStatus === "trialing" ? "trial_cancelled" : null;
  if (type === "RENEWAL" || type === "PRODUCT_CHANGE" || type === "UNCANCELLATION") {
    if (previousStatus === "trialing" && periodType !== "TRIAL") return "trial_converted";
    if (type === "RENEWAL" && previousStatus !== "trialing") return "renewed";
  }
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

  try {
    const status = mapStatus(event.type, event.period_type);
    if (!status) {
      await webhookEventRepo.markProcessed(ledger.id, "processed");
      return "ignored";
    }

    const user = await userRepo.findById(event.app_user_id);
    if (!user) {
      logger.warn(
        { appUserId: event.app_user_id, type: event.type },
        "revenuecat webhook for unknown app_user_id"
      );
      await webhookEventRepo.markProcessed(ledger.id, "processed");
      return "ignored";
    }

    const eventAt = event.event_timestamp_ms ? new Date(event.event_timestamp_ms) : new Date();
    const periodEnd = event.expiration_at_ms ? new Date(event.expiration_at_ms) : null;
    const previousSub = await subscriptionRepo.getByUser(user.id);
    const funnelEventType = classifySubscriptionEvent(
      event.type,
      event.period_type,
      previousSub?.status ?? null
    );
    const applied = await persistSubscriptionAndMirror(
      user.id,
      {
        userId: user.id,
        rcAppUserId: event.app_user_id,
        provider: mapStore(event.store),
        productId: event.product_id ?? null,
        status,
        trialEnd: status === "trialing" ? periodEnd : (user.trialEndsAt ?? null),
        currentPeriodStart: event.purchased_at_ms ? new Date(event.purchased_at_ms) : null,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: status === "canceled",
        lastEventAt: eventAt,
      },
      funnelEventType
        ? {
            userId: user.id,
            eventType: funnelEventType,
            productId: event.product_id ?? null,
            occurredAt: eventAt,
            rawEventId: ledger.id,
          }
        : undefined
    );

    // `applied === null` ⇒ the atomic write's monotonic guard dropped this event
    // as stale/out-of-order — same externally-visible outcome as an ignored event
    // type, just decided by the DB instead of the mapping above.
    await webhookEventRepo.markProcessed(ledger.id, "processed");

    // Only the CANCELLATION event itself, and only when it actually applied —
    // never on EXPIRATION (already communicated via the trial-ending reminder)
    // and never on a stale/out-of-order event the monotonic guard dropped.
    if (applied && event.type === "CANCELLATION" && user.email) {
      await sendCancellationEmail(user.email, user.id);
    }

    return applied ? "processed" : "ignored";
  } catch (err) {
    logger.error({ err, eventId: event.id, type: event.type }, "revenuecat webhook failed");
    await webhookEventRepo.markProcessed(ledger.id, "failed");
    throw err;
  }
}

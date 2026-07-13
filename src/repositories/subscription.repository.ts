import { and, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { subscriptions, type NewSubscriptionRow, type SubscriptionRow } from "../../db/schema";

export type Subscription = SubscriptionRow;

export async function getByUser(userId: string, tx: Executor = db): Promise<Subscription | null> {
  const [row] = await tx
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);
  return row ?? null;
}

/** Admin batch — one subscription row per user when present. */
export async function getByUserIds(userIds: string[], tx: Executor = db): Promise<Subscription[]> {
  if (userIds.length === 0) return [];
  return tx.select().from(subscriptions).where(inArray(subscriptions.userId, userIds));
}

/**
 * Webhook-driven projection: one row per user, upserted from RevenueCat/Stripe events.
 *
 * Monotonic by event time, enforced atomically in the `WHERE` of the conflict
 * update — not by a read-then-compare in the caller — so two events applied
 * concurrently (e.g. a redelivered stale EXPIRATION racing a fresh RENEWAL on
 * another connection) can't both pass a guard and let the older one win. If the
 * existing row's `last_event_at` is not older than the incoming event, Postgres
 * skips the update and `RETURNING` yields nothing: the caller sees `null` and
 * must treat that as "stale event, no-op" rather than an error.
 *
 * Ties (equal `last_event_at`, e.g. two events sharing a timestamp) resolve to
 * "first to commit wins" — the second's `<` comparison fails once the first has
 * written. Acceptable here: RevenueCat/Stripe timestamps are millisecond-precision,
 * so true ties are rare, and first-committed-wins is still a consistent, race-free
 * outcome (never a torn write).
 */
export async function upsertFromWebhook(
  input: NewSubscriptionRow,
  tx: Executor = db
): Promise<Subscription | null> {
  const { id: _id, createdAt: _c, ...set } = input;
  const eventAt = input.lastEventAt;
  const [row] = await tx
    .insert(subscriptions)
    .values(input)
    .onConflictDoUpdate({
      target: subscriptions.userId,
      set,
      setWhere: eventAt
        ? or(isNull(subscriptions.lastEventAt), lt(subscriptions.lastEventAt, eventAt))
        : undefined,
    })
    .returning();
  return row ?? null;
}

/**
 * Reconcile sweep: flip live subscriptions whose period has ended to `expired`
 * and return the affected rows so the caller can mirror tier → free. Served by
 * the (status) + (current_period_end) indexes.
 *
 * Includes `trialing`: a trial whose EXPIRATION webhook is dropped must still be
 * caught by this backstop. RevenueCat trial events set `current_period_end` equal
 * to the trial end (see billing-webhook.service's `trialEnd: periodEnd` mapping
 * and subscription.service's `startTrial`, which both write the same value to
 * `currentPeriodEnd` and `trialEnd`), so the existing `currentPeriodEnd ≤ now`
 * predicate already covers trials once the status is included — no separate
 * `trialEnd` predicate needed.
 */
export async function expireOverdue(now: Date, tx: Executor = db): Promise<Subscription[]> {
  return tx
    .update(subscriptions)
    .set({ status: "expired" })
    .where(
      and(
        inArray(subscriptions.status, ["trialing", "active", "in_grace", "past_due", "canceled"]),
        lte(subscriptions.currentPeriodEnd, now)
      )
    )
    .returning();
}

/**
 * Revenue-generating subscriptions grouped by product id — the basis for MRR
 * and the plan-breakdown split. Trialing and canceled-but-not-yet-expired
 * subscriptions don't count: they're not currently producing revenue.
 */
export async function countActiveByProductId(
  tx: Executor = db
): Promise<Array<{ productId: string | null; count: number }>> {
  return tx
    .select({ productId: subscriptions.productId, count: sql<number>`count(*)::int` })
    .from(subscriptions)
    .where(inArray(subscriptions.status, ["active", "in_grace", "past_due"]))
    .groupBy(subscriptions.productId);
}

/**
 * Subscriptions that flipped to `expired` on or after `since` — used to
 * attribute churned MRR to the day it actually happened, for the daily
 * snapshot. Relies on `expireOverdue`'s write bumping `updated_at`.
 */
export async function listExpiredSince(
  since: Date,
  tx: Executor = db
): Promise<Array<{ productId: string | null }>> {
  return tx
    .select({ productId: subscriptions.productId })
    .from(subscriptions)
    .where(and(eq(subscriptions.status, "expired"), gte(subscriptions.updatedAt, since)));
}

/** Trial-reminder sweep — served by the (current_period_end) / (status) indexes. */
export async function listTrialsEndingWithin(
  from: Date,
  to: Date,
  tx: Executor = db
): Promise<Subscription[]> {
  return tx
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.status, "trialing"),
        gte(subscriptions.trialEnd, from),
        lte(subscriptions.trialEnd, to)
      )
    );
}

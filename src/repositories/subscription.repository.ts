import { and, eq, gte, inArray, lte } from "drizzle-orm";
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

/** Webhook-driven projection: one row per user, upserted from RevenueCat/Stripe events. */
export async function upsertFromWebhook(
  input: NewSubscriptionRow,
  tx: Executor = db
): Promise<Subscription> {
  const { id: _id, createdAt: _c, ...set } = input;
  const [row] = await tx
    .insert(subscriptions)
    .values(input)
    .onConflictDoUpdate({ target: subscriptions.userId, set })
    .returning();
  return row;
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

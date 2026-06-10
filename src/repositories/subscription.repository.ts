import { and, eq, gte, lte } from "drizzle-orm";
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

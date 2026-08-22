import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import {
  subscriptionEvents,
  type NewSubscriptionEventRow,
  type SubscriptionEventRow,
  type SubscriptionEventType,
} from "../../db/schema";

export type SubscriptionEvent = SubscriptionEventRow;

/** Append a funnel event. Callers pass the active `tx` to write it atomically
 *  alongside the `subscriptions` upsert it describes. */
export async function insert(
  input: NewSubscriptionEventRow,
  tx: Executor = db
): Promise<SubscriptionEvent> {
  const [row] = await tx.insert(subscriptionEvents).values(input).returning();
  return row;
}

/** Counts per event type since `startDate` — powers the trial pipeline card. */
export async function countByTypeSince(
  startDate: Date,
  tx: Executor = db
): Promise<Record<SubscriptionEventType, number>> {
  return countByTypeInRange(startDate, undefined, tx);
}

/** Counts per event type within an explicit [from, to] window. */
export async function countByTypeInRange(
  from: Date,
  to: Date | undefined,
  tx: Executor = db
): Promise<Record<SubscriptionEventType, number>> {
  const where = to
    ? and(gte(subscriptionEvents.occurredAt, from), lte(subscriptionEvents.occurredAt, to))
    : gte(subscriptionEvents.occurredAt, from);

  const rows = await tx
    .select({ eventType: subscriptionEvents.eventType, count: sql<number>`count(*)::int` })
    .from(subscriptionEvents)
    .where(where)
    .groupBy(subscriptionEvents.eventType);

  const result: Record<SubscriptionEventType, number> = {
    trial_started: 0,
    trial_converted: 0,
    trial_cancelled: 0,
    renewed: 0,
    expired: 0,
  };
  for (const row of rows) result[row.eventType] = row.count;
  return result;
}

/** Full funnel history for one user, oldest first — feeds the admin
 *  user-detail timeline and the trial-started/converted/first-charge dates. */
export async function listByUser(userId: string, tx: Executor = db): Promise<SubscriptionEvent[]> {
  return tx
    .select()
    .from(subscriptionEvents)
    .where(eq(subscriptionEvents.userId, userId))
    .orderBy(asc(subscriptionEvents.occurredAt));
}

/** Sum of `price_amount_cents` for a user — "revenue to date". `null` (not 0)
 *  when every row is unpriced, so "no data yet" stays distinguishable from "$0". */
export async function sumPriceAmountCentsByUser(
  userId: string,
  tx: Executor = db
): Promise<number | null> {
  const [row] = await tx
    .select({ total: sql<number | null>`sum(${subscriptionEvents.priceAmountCents})::int` })
    .from(subscriptionEvents)
    .where(eq(subscriptionEvents.userId, userId));
  return row?.total ?? null;
}

export async function sumPriceAmountCentsByCurrencyByUser(
  userId: string,
  tx: Executor = db
): Promise<{ amountCents: number; currency: string }[]> {
  const rows = await tx
    .select({
      amountCents: sql<number>`sum(${subscriptionEvents.priceAmountCents})::int`,
      currency: subscriptionEvents.currency,
    })
    .from(subscriptionEvents)
    .where(eq(subscriptionEvents.userId, userId))
    .groupBy(subscriptionEvents.currency);
  return rows
    .filter((row): row is { amountCents: number; currency: string } => Boolean(row.currency))
    .map((row) => ({ amountCents: row.amountCents, currency: row.currency.toUpperCase() }));
}

/** scripts/backfill-subscription-event-prices.ts — write the reconstructed price. */
export async function updatePrice(
  id: string,
  priceAmountCents: number,
  currency: string | null,
  tx: Executor = db
): Promise<void> {
  await tx
    .update(subscriptionEvents)
    .set({ priceAmountCents, currency })
    .where(eq(subscriptionEvents.id, id));
}

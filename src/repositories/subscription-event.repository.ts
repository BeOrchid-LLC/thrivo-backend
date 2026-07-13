import { gte, sql } from "drizzle-orm";
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
  const rows = await tx
    .select({ eventType: subscriptionEvents.eventType, count: sql<number>`count(*)::int` })
    .from(subscriptionEvents)
    .where(gte(subscriptionEvents.occurredAt, startDate))
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

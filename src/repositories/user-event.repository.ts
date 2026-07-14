import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import {
  userEvents,
  type NewUserEventRow,
  type UserEventRow,
  type UserEventType,
} from "../../db/schema";

export type UserEvent = UserEventRow;

/** No caller yet (future mobile-app instrumentation). */
export async function insert(input: NewUserEventRow, tx: Executor = db): Promise<UserEvent> {
  const [row] = await tx.insert(userEvents).values(input).returning();
  return row;
}

/** Full product-event history for one user, oldest first — feeds the admin
 *  user-detail timeline. */
export async function listByUser(userId: string, tx: Executor = db): Promise<UserEvent[]> {
  return tx
    .select()
    .from(userEvents)
    .where(eq(userEvents.userId, userId))
    .orderBy(asc(userEvents.occurredAt));
}

/** Most recent event of a given type — e.g. the header's "Converted via X"
 *  reads the latest `upgrade_prompt_shown` metadata.trigger. */
export async function findLatestByType(
  userId: string,
  eventType: UserEventType,
  tx: Executor = db
): Promise<UserEvent | null> {
  const [row] = await tx
    .select()
    .from(userEvents)
    .where(and(eq(userEvents.userId, userId), eq(userEvents.eventType, eventType)))
    .orderBy(desc(userEvents.occurredAt))
    .limit(1);
  return row ?? null;
}

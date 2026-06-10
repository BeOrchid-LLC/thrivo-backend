import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { foodLogs, type FoodLogRow, type NewFoodLogRow } from "../../db/schema";

export type FoodLog = FoodLogRow;

export async function createLog(input: NewFoodLogRow, tx: Executor = db): Promise<FoodLog> {
  const [row] = await tx.insert(foodLogs).values(input).returning();
  return row;
}

/** The dominant diary query — served by the (user_id, local_date) index. */
export async function listLogsForDay(
  userId: string,
  localDate: string,
  tx: Executor = db
): Promise<FoodLog[]> {
  return tx
    .select()
    .from(foodLogs)
    .where(and(eq(foodLogs.userId, userId), eq(foodLogs.localDate, localDate)))
    .orderBy(asc(foodLogs.loggedAt));
}

export async function listLogsByRange(
  userId: string,
  fromLoggedAt: Date,
  toLoggedAt: Date,
  tx: Executor = db
): Promise<FoodLog[]> {
  return tx
    .select()
    .from(foodLogs)
    .where(
      and(
        eq(foodLogs.userId, userId),
        gte(foodLogs.loggedAt, fromLoggedAt),
        lte(foodLogs.loggedAt, toLoggedAt)
      )
    )
    .orderBy(asc(foodLogs.loggedAt));
}

// Composite PK (id, logged_at): both parts are required to address a single row.
export async function updateLog(
  id: string,
  loggedAt: Date,
  patch: Partial<NewFoodLogRow>,
  tx: Executor = db
): Promise<FoodLog | null> {
  const [row] = await tx
    .update(foodLogs)
    .set(patch)
    .where(and(eq(foodLogs.id, id), eq(foodLogs.loggedAt, loggedAt)))
    .returning();
  return row ?? null;
}

export async function deleteLog(id: string, loggedAt: Date, tx: Executor = db): Promise<void> {
  await tx.delete(foodLogs).where(and(eq(foodLogs.id, id), eq(foodLogs.loggedAt, loggedAt)));
}

import { and, asc, count, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { foodLogs, type FoodLogRow, type NewFoodLogRow } from "../../db/schema";

export type FoodLog = FoodLogRow;

export async function createLog(input: NewFoodLogRow, tx: Executor = db): Promise<FoodLog> {
  const [row] = await tx
    .insert(foodLogs)
    .values(input)
    // NULL keys are distinct, so key-less logs always insert. A repeated
    // (user, idempotency_key) — a retry or offline-queue replay — conflicts and
    // returns nothing; we then return the row that already landed.
    .onConflictDoNothing({ target: [foodLogs.userId, foodLogs.idempotencyKey] })
    .returning();
  if (row) return row;
  const [existing] = await tx
    .select()
    .from(foodLogs)
    .where(
      and(eq(foodLogs.userId, input.userId), eq(foodLogs.idempotencyKey, input.idempotencyKey!))
    )
    .limit(1);
  return existing;
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
    .orderBy(desc(foodLogs.consumedAt), desc(foodLogs.loggedAt));
}

export interface FoodLogTotals {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/** Aggregate snapshots for a user-day; used as a fallback when daily_summaries is empty. */
export async function totalsForDay(
  userId: string,
  localDate: string,
  tx: Executor = db
): Promise<FoodLogTotals> {
  const [row] = await tx
    .select({
      calories: sql<number>`coalesce(sum(${foodLogs.kcal}), 0)::int`,
      proteinG: sql<string>`coalesce(sum(${foodLogs.proteinG}), 0)::text`,
      carbsG: sql<string>`coalesce(sum(${foodLogs.carbsG}), 0)::text`,
      fatG: sql<string>`coalesce(sum(${foodLogs.fatG}), 0)::text`,
    })
    .from(foodLogs)
    .where(and(eq(foodLogs.userId, userId), eq(foodLogs.localDate, localDate)));

  return {
    calories: row?.calories ?? 0,
    proteinG: Number(row?.proteinG ?? 0),
    carbsG: Number(row?.carbsG ?? 0),
    fatG: Number(row?.fatG ?? 0),
  };
}

export async function listLogsByLocalDateRange(
  userId: string,
  fromDate: string,
  toDate: string,
  tx: Executor = db
): Promise<FoodLog[]> {
  return tx
    .select()
    .from(foodLogs)
    .where(
      and(
        eq(foodLogs.userId, userId),
        gte(foodLogs.localDate, fromDate),
        lte(foodLogs.localDate, toDate)
      )
    )
    .orderBy(desc(foodLogs.localDate), desc(foodLogs.consumedAt), desc(foodLogs.loggedAt));
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

export async function listRecentLogs(
  userId: string,
  limit = 20,
  tx: Executor = db
): Promise<FoodLog[]> {
  return tx
    .select()
    .from(foodLogs)
    .where(eq(foodLogs.userId, userId))
    .orderBy(desc(foodLogs.consumedAt), desc(foodLogs.loggedAt))
    .limit(limit);
}

export async function findLogForUser(
  userId: string,
  id: string,
  tx: Executor = db
): Promise<FoodLog | null> {
  const [row] = await tx
    .select()
    .from(foodLogs)
    .where(and(eq(foodLogs.userId, userId), eq(foodLogs.id, id)))
    .limit(1);
  return row ?? null;
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

export async function updateLogForUser(
  userId: string,
  id: string,
  patch: Partial<NewFoodLogRow>,
  tx: Executor = db
): Promise<FoodLog | null> {
  const [row] = await tx
    .update(foodLogs)
    .set(patch)
    .where(and(eq(foodLogs.userId, userId), eq(foodLogs.id, id)))
    .returning();
  return row ?? null;
}

export async function deleteLog(id: string, loggedAt: Date, tx: Executor = db): Promise<void> {
  await tx.delete(foodLogs).where(and(eq(foodLogs.id, id), eq(foodLogs.loggedAt, loggedAt)));
}

export async function deleteLogForUser(
  userId: string,
  id: string,
  tx: Executor = db
): Promise<FoodLog | null> {
  const [row] = await tx
    .delete(foodLogs)
    .where(and(eq(foodLogs.userId, userId), eq(foodLogs.id, id)))
    .returning();
  return row ?? null;
}

/** Every log snapshot that still points at a given catalog item — the R1-5 backfill's repair set. */
export async function listByFoodItemId(foodItemId: string, tx: Executor = db): Promise<FoodLog[]> {
  return tx.select().from(foodLogs).where(eq(foodLogs.foodItemId, foodItemId));
}

/** Admin batch — food log counts keyed by user id. */
export async function countByUserIds(
  userIds: string[],
  tx: Executor = db
): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();

  const rows = await tx
    .select({ userId: foodLogs.userId, value: count() })
    .from(foodLogs)
    .where(inArray(foodLogs.userId, userIds))
    .groupBy(foodLogs.userId);

  return new Map(rows.map((row) => [row.userId, Number(row.value)]));
}

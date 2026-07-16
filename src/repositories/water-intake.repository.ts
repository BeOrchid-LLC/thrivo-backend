import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { waterIntake, type NewWaterIntakeRow, type WaterIntakeRow } from "../../db/schema";

export type WaterIntake = WaterIntakeRow;

/** Total ml logged for a user-day — powers the daily ring rollup. */
export async function getDayTotal(
  userId: string,
  localDate: string,
  tx: Executor = db
): Promise<number> {
  const [row] = await tx
    .select({ total: sql<number>`coalesce(sum(${waterIntake.amountMl}), 0)::int` })
    .from(waterIntake)
    .where(and(eq(waterIntake.userId, userId), eq(waterIntake.localDate, localDate)));
  return row?.total ?? 0;
}

export async function addEntry(input: NewWaterIntakeRow, tx: Executor = db): Promise<WaterIntake> {
  const [row] = await tx
    .insert(waterIntake)
    .values(input)
    // Dedupe at-least-once writes: a repeated (user, idempotency_key) conflicts
    // and returns nothing, so we return the entry that already landed.
    .onConflictDoNothing({ target: [waterIntake.userId, waterIntake.idempotencyKey] })
    .returning();
  if (row) return row;
  const [existing] = await tx
    .select()
    .from(waterIntake)
    .where(
      and(
        eq(waterIntake.userId, input.userId),
        eq(waterIntake.idempotencyKey, input.idempotencyKey!)
      )
    )
    .limit(1);
  return existing;
}

export async function listEntriesForDay(
  userId: string,
  localDate: string,
  tx: Executor = db
): Promise<WaterIntake[]> {
  return tx
    .select()
    .from(waterIntake)
    .where(and(eq(waterIntake.userId, userId), eq(waterIntake.localDate, localDate)))
    .orderBy(desc(waterIntake.recordedAt));
}

export async function listEntriesByLocalDateRange(
  userId: string,
  fromDate: string,
  toDate: string,
  tx: Executor = db
): Promise<WaterIntake[]> {
  return tx
    .select()
    .from(waterIntake)
    .where(
      and(
        eq(waterIntake.userId, userId),
        gte(waterIntake.localDate, fromDate),
        lte(waterIntake.localDate, toDate)
      )
    )
    .orderBy(desc(waterIntake.localDate), desc(waterIntake.recordedAt));
}

export async function listTotalsRange(
  userId: string,
  fromDate: string,
  toDate: string,
  tx: Executor = db
): Promise<Array<{ day: string; totalMl: number }>> {
  const rows = await tx
    .select({
      day: waterIntake.localDate,
      totalMl: sql<number>`coalesce(sum(${waterIntake.amountMl}), 0)::int`,
    })
    .from(waterIntake)
    .where(
      and(
        eq(waterIntake.userId, userId),
        gte(waterIntake.localDate, fromDate),
        lte(waterIntake.localDate, toDate)
      )
    )
    .groupBy(waterIntake.localDate)
    .orderBy(asc(waterIntake.localDate));
  return rows.map((row) => ({ day: row.day, totalMl: row.totalMl }));
}

export async function updateEntryForUser(
  userId: string,
  id: string,
  updates: Partial<Pick<NewWaterIntakeRow, "amountMl" | "recordedAt">>,
  tx: Executor = db
): Promise<WaterIntake | null> {
  const [row] = await tx
    .update(waterIntake)
    .set(updates)
    .where(and(eq(waterIntake.userId, userId), eq(waterIntake.id, id)))
    .returning();
  return row ?? null;
}

export async function deleteEntryForUser(
  userId: string,
  id: string,
  tx: Executor = db
): Promise<WaterIntake | null> {
  const [row] = await tx
    .delete(waterIntake)
    .where(and(eq(waterIntake.userId, userId), eq(waterIntake.id, id)))
    .returning();
  return row ?? null;
}

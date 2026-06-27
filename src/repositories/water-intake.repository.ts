import { and, asc, eq, sql } from "drizzle-orm";
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
  const [row] = await tx.insert(waterIntake).values(input).returning();
  return row;
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
    .orderBy(asc(waterIntake.recordedAt));
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

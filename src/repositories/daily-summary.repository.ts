import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { dailySummaries, type DailySummaryRow, type NewDailySummaryRow } from "../../db/schema";

export type DailySummary = DailySummaryRow;

export async function getForDay(
  userId: string,
  localDate: string,
  tx: Executor = db
): Promise<DailySummary | null> {
  const [row] = await tx
    .select()
    .from(dailySummaries)
    .where(and(eq(dailySummaries.userId, userId), eq(dailySummaries.localDate, localDate)))
    .limit(1);
  return row ?? null;
}

/** Upsert the denormalized rollup for a day — keyed by unique(user_id, local_date). */
export async function upsertForDay(
  input: NewDailySummaryRow,
  tx: Executor = db
): Promise<DailySummary> {
  const { id: _id, createdAt: _c, ...set } = input;
  const [row] = await tx
    .insert(dailySummaries)
    .values(input)
    .onConflictDoUpdate({
      target: [dailySummaries.userId, dailySummaries.localDate],
      set,
    })
    .returning();
  return row;
}

export async function listRange(
  userId: string,
  fromDate: string,
  toDate: string,
  tx: Executor = db
): Promise<DailySummary[]> {
  return tx
    .select()
    .from(dailySummaries)
    .where(
      and(
        eq(dailySummaries.userId, userId),
        gte(dailySummaries.localDate, fromDate),
        lte(dailySummaries.localDate, toDate)
      )
    )
    .orderBy(dailySummaries.localDate);
}

import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { checkIns, type CheckInRow, type NewCheckInRow } from "../../db/schema";

export type CheckIn = CheckInRow;

export async function getForDay(
  userId: string,
  localDate: string,
  tx: Executor = db
): Promise<CheckIn | null> {
  const [row] = await tx
    .select()
    .from(checkIns)
    .where(and(eq(checkIns.userId, userId), eq(checkIns.localDate, localDate)))
    .limit(1);
  return row ?? null;
}

/** unique(user_id, local_date) enforces one check-in per day. */
export async function createCheckIn(input: NewCheckInRow, tx: Executor = db): Promise<CheckIn> {
  const [row] = await tx.insert(checkIns).values(input).returning();
  return row;
}

/** Upsert today's check-in — re-checking in the same day updates mood/note/tip. */
export async function upsertForDay(input: NewCheckInRow, tx: Executor = db): Promise<CheckIn> {
  const [row] = await tx
    .insert(checkIns)
    .values(input)
    .onConflictDoUpdate({
      target: [checkIns.userId, checkIns.localDate],
      set: { mood: input.mood, note: input.note ?? null, tipId: input.tipId ?? null },
    })
    .returning();
  return row;
}

export async function listForUser(
  userId: string,
  limit = 30,
  tx: Executor = db
): Promise<CheckIn[]> {
  return tx
    .select()
    .from(checkIns)
    .where(eq(checkIns.userId, userId))
    .orderBy(desc(checkIns.localDate))
    .limit(limit);
}

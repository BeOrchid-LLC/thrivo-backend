import { and, eq } from "drizzle-orm";
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

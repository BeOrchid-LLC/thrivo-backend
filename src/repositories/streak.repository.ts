import { eq } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { streaks, type NewStreakRow, type StreakRow } from "../../db/schema";

export type Streak = StreakRow;

export async function getByUser(userId: string, tx: Executor = db): Promise<Streak | null> {
  const [row] = await tx.select().from(streaks).where(eq(streaks.userId, userId)).limit(1);
  return row ?? null;
}

/** One row per user — upsert on the user_id PK. */
export async function upsertStreak(input: NewStreakRow, tx: Executor = db): Promise<Streak> {
  const { userId: _u, createdAt: _c, ...set } = input;
  const [row] = await tx
    .insert(streaks)
    .values(input)
    .onConflictDoUpdate({ target: streaks.userId, set })
    .returning();
  return row;
}

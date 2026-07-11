import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { streaks, type NewStreakRow, type StreakRow } from "../../db/schema";

export type Streak = StreakRow;

/**
 * Serialize concurrent streak recomputes for one user. Transaction-scoped
 * advisory lock — MUST be called inside a `db.transaction` (it auto-releases
 * on commit/rollback) or it releases immediately and protects nothing. Salt
 * `1` (vs daily-summary's `0`, see daily-summary.repository.lockForDay) keeps
 * the two lock domains from colliding on the same hash space.
 */
export async function lockForUser(userId: string, tx: Executor = db): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 1))`);
}

export async function getByUser(userId: string, tx: Executor = db): Promise<Streak | null> {
  const [row] = await tx.select().from(streaks).where(eq(streaks.userId, userId)).limit(1);
  return row ?? null;
}

/** Admin batch — streak rows for the given user ids. */
export async function getByUserIds(userIds: string[], tx: Executor = db): Promise<Streak[]> {
  if (userIds.length === 0) return [];
  return tx.select().from(streaks).where(inArray(streaks.userId, userIds));
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

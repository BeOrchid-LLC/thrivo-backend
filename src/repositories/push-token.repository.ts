import { and, asc, eq, getTableColumns, gt, inArray, isNull, or } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { pushTokens, userSettings, type NewPushTokenRow, type PushTokenRow } from "../../db/schema";

export type PushToken = PushTokenRow;

/**
 * Keyset page of tokens eligible for the daily nudge: the owner has not switched
 * off push notifications. A missing settings row counts as enabled (the column
 * defaults to true), so users are never silently dropped from nudges by a left
 * join. Ordered by `id` (the PK, already indexed) so `gt(id, afterId)` is a
 * stable cursor — replaces the old unbounded `listActiveForNudges` (R5-3/I15),
 * which loaded every active token into memory in one round-trip.
 */
export async function listActiveForNudgesPage(
  afterId: string | null,
  limit: number,
  tx: Executor = db
): Promise<PushToken[]> {
  return tx
    .select(getTableColumns(pushTokens))
    .from(pushTokens)
    .leftJoin(userSettings, eq(userSettings.userId, pushTokens.userId))
    .where(
      and(
        eq(pushTokens.isActive, true),
        or(isNull(userSettings.userId), eq(userSettings.pushNotificationsEnabled, true)),
        afterId ? gt(pushTokens.id, afterId) : undefined
      )
    )
    .orderBy(asc(pushTokens.id))
    .limit(limit);
}

/** Upsert on the token (unique) — re-registering a device refreshes its owner + activity. */
export async function register(input: NewPushTokenRow, tx: Executor = db): Promise<PushToken> {
  const [row] = await tx
    .insert(pushTokens)
    .values(input)
    .onConflictDoUpdate({
      target: pushTokens.expoPushToken,
      set: {
        userId: input.userId,
        platform: input.platform,
        isActive: true,
        lastUsedAt: new Date(),
      },
    })
    .returning();
  return row;
}

export async function listForUser(userId: string, tx: Executor = db): Promise<PushToken[]> {
  return tx.select().from(pushTokens).where(eq(pushTokens.userId, userId));
}

/** Deactivate tokens Expo reported as invalid (pruned lazily, not deleted). */
export async function pruneInvalid(tokens: string[], tx: Executor = db): Promise<void> {
  if (tokens.length === 0) return;
  await tx
    .update(pushTokens)
    .set({ isActive: false })
    .where(inArray(pushTokens.expoPushToken, tokens));
}

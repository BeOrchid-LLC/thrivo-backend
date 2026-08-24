import { and, asc, eq, getTableColumns, gt, inArray, isNull, or } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import {
  pushTokens,
  userSettings,
  users,
  type NewPushTokenRow,
  type PushTokenRow,
} from "../../db/schema";

export type PushToken = PushTokenRow;

/**
 * Keyset page of tokens eligible for the daily psychology-tip push.
 */
export async function listActiveForNudgesPage(
  afterId: string | null,
  limit: number,
  tx: Executor = db
): Promise<PushToken[]> {
  return tx
    .select(getTableColumns(pushTokens))
    .from(pushTokens)
    .innerJoin(users, eq(users.id, pushTokens.userId))
    .leftJoin(userSettings, eq(userSettings.userId, pushTokens.userId))
    .where(
      and(
        eq(pushTokens.isActive, true),
        isNull(users.deletedAt),
        or(isNull(userSettings.userId), eq(userSettings.pushNotificationsEnabled, true)),
        or(isNull(userSettings.userId), eq(userSettings.psychologyTipPushEnabled, true)),
        afterId ? gt(pushTokens.id, afterId) : undefined
      )
    )
    .orderBy(asc(pushTokens.id))
    .limit(limit);
}

export type FoodLogReminderRecipient = {
  tokenId: string;
  userId: string;
  expoPushToken: string;
  notifyTimes: string[] | null;
  timezone: string | null;
};

/** Active devices whose users can receive local-time food-log reminders. */
export async function listActiveForFoodLogRemindersPage(
  afterId: string | null,
  limit: number,
  tx: Executor = db
): Promise<FoodLogReminderRecipient[]> {
  const rows = await tx
    .select({
      tokenId: pushTokens.id,
      userId: pushTokens.userId,
      expoPushToken: pushTokens.expoPushToken,
      notifyTimes: users.notifyTimes,
      timezone: users.timezone,
    })
    .from(pushTokens)
    .innerJoin(users, eq(users.id, pushTokens.userId))
    .leftJoin(userSettings, eq(userSettings.userId, pushTokens.userId))
    .where(
      and(
        eq(pushTokens.isActive, true),
        isNull(users.deletedAt),
        or(isNull(userSettings.userId), eq(userSettings.pushNotificationsEnabled, true)),
        or(isNull(userSettings.userId), eq(userSettings.dailyFoodLogReminderEnabled, true)),
        afterId ? gt(pushTokens.id, afterId) : undefined
      )
    )
    .orderBy(asc(pushTokens.id))
    .limit(limit);
  return rows;
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

export async function deactivateForUser(userId: string, tx: Executor = db): Promise<void> {
  await tx.update(pushTokens).set({ isActive: false }).where(eq(pushTokens.userId, userId));
}

/** Deactivate tokens Expo reported as invalid (pruned lazily, not deleted). */
export async function pruneInvalid(tokens: string[], tx: Executor = db): Promise<void> {
  if (tokens.length === 0) return;
  await tx
    .update(pushTokens)
    .set({ isActive: false })
    .where(inArray(pushTokens.expoPushToken, tokens));
}

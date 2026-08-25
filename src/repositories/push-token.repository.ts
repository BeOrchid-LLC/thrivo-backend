import { and, asc, eq, getTableColumns, gt, inArray, isNull, ne, or } from "drizzle-orm";
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

/**
 * Register an Expo token and retire the previous token for the same app
 * installation when the provider rotates it. Legacy callers without a
 * deviceId retain token-only upsert behavior until they upgrade.
 */
async function registerWithExecutor(input: NewPushTokenRow, tx: Executor): Promise<PushToken> {
  const now = new Date();

  if (input.deviceId) {
    const [existingDevice] = await tx
      .select({ id: pushTokens.id })
      .from(pushTokens)
      .where(and(eq(pushTokens.userId, input.userId), eq(pushTokens.deviceId, input.deviceId)))
      .limit(1);

    if (existingDevice) {
      // The incoming token may still be attached to a stale row. Tokens are
      // globally unique, so remove that stale association before refreshing the
      // current installation row.
      await tx
        .delete(pushTokens)
        .where(
          and(
            eq(pushTokens.expoPushToken, input.expoPushToken),
            ne(pushTokens.id, existingDevice.id)
          )
        );

      const [row] = await tx
        .update(pushTokens)
        .set({
          expoPushToken: input.expoPushToken,
          platform: input.platform,
          isActive: true,
          lastUsedAt: now,
        })
        .where(eq(pushTokens.id, existingDevice.id))
        .returning();
      return row;
    }
  }

  const [row] = await tx
    .insert(pushTokens)
    .values({ ...input, lastUsedAt: now })
    .onConflictDoUpdate({
      target: pushTokens.expoPushToken,
      set: {
        userId: input.userId,
        platform: input.platform,
        ...(input.deviceId === undefined ? {} : { deviceId: input.deviceId }),
        isActive: true,
        lastUsedAt: now,
      },
    })
    .returning();
  return row;
}

/** Serialize device-token replacement when called with the shared DB handle. */
export async function register(input: NewPushTokenRow, tx: Executor = db): Promise<PushToken> {
  if (tx === db) return db.transaction((transaction) => registerWithExecutor(input, transaction));
  return registerWithExecutor(input, tx);
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

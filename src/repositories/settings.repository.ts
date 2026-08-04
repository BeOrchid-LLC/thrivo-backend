import { eq } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import {
  globalSettings,
  userSettings,
  type GlobalSettingsRow,
  type NewGlobalSettingsRow,
  type NewUserSettingsRow,
  type UserSettingsRow,
} from "../../db/schema";

export const GLOBAL_SETTINGS_KEY = "default" as const;

export const DEFAULT_GLOBAL_SETTINGS = {
  key: GLOBAL_SETTINGS_KEY,
  pushNotificationsEnabled: true,
  dailyFoodLogReminderEnabled: true,
  emailFoodLogReminderEnabled: true,
  weeklyReviewEmailEnabled: true,
  weightCheckReminderEnabled: true,
  hydrationReminderEnabled: true,
  subscriptionsEnabled: true,
  trialsEnabled: true,
  purchasesEnabled: true,
  cancellationsEnabled: true,
  trialDays: 14,
} satisfies NewGlobalSettingsRow;

export const DEFAULT_USER_SETTINGS = {
  unitSystem: "metric",
  pushNotificationsEnabled: true,
  dailyFoodLogReminderEnabled: true,
  dailyFoodLogReminderTime: "08:00",
  emailFoodLogReminderEnabled: true,
  weeklyReviewEmailEnabled: true,
  weightCheckReminderEnabled: true,
  weightCheckReminderDay: "friday",
  weightCheckReminderTime: "09:00",
  hydrationReminderEnabled: true,
  hydrationReminderIntervalMinutes: 40,
} satisfies Omit<NewUserSettingsRow, "userId">;

export type GlobalSettings = GlobalSettingsRow;
export type UserSettings = UserSettingsRow;

export async function getGlobalSettings(tx: Executor = db): Promise<GlobalSettings | null> {
  const [row] = await tx
    .select()
    .from(globalSettings)
    .where(eq(globalSettings.key, GLOBAL_SETTINGS_KEY))
    .limit(1);
  return row ?? null;
}

export async function upsertGlobalDefaults(tx: Executor = db): Promise<GlobalSettings> {
  const [row] = await tx
    .insert(globalSettings)
    .values(DEFAULT_GLOBAL_SETTINGS)
    .onConflictDoUpdate({
      target: globalSettings.key,
      set: { key: GLOBAL_SETTINGS_KEY },
    })
    .returning();
  return row;
}

export async function updateGlobalSettings(
  patch: Partial<NewGlobalSettingsRow>,
  tx: Executor = db
): Promise<GlobalSettings> {
  const weekly = patch.weeklyReviewEmailEnabled ?? patch.emailFoodLogReminderEnabled;
  if (weekly !== undefined) {
    patch = {
      ...patch,
      weeklyReviewEmailEnabled: weekly,
      emailFoodLogReminderEnabled: weekly,
    };
  }
  const [row] = await tx
    .insert(globalSettings)
    .values({ ...DEFAULT_GLOBAL_SETTINGS, ...patch, key: GLOBAL_SETTINGS_KEY })
    .onConflictDoUpdate({
      target: globalSettings.key,
      set: { ...patch, key: GLOBAL_SETTINGS_KEY },
    })
    .returning();
  return row;
}

export async function getUserSettings(
  userId: string,
  tx: Executor = db
): Promise<UserSettings | null> {
  const [row] = await tx
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  return row ?? null;
}

export async function getOrCreateUserSettings(
  userId: string,
  tx: Executor = db
): Promise<UserSettings> {
  const [row] = await tx
    .insert(userSettings)
    .values({ ...DEFAULT_USER_SETTINGS, userId })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: { userId },
    })
    .returning();
  return row;
}

export async function updateUserSettings(
  userId: string,
  patch: Partial<NewUserSettingsRow>,
  tx: Executor = db
): Promise<UserSettings> {
  const weekly = patch.weeklyReviewEmailEnabled ?? patch.emailFoodLogReminderEnabled;
  if (weekly !== undefined) {
    patch = {
      ...patch,
      weeklyReviewEmailEnabled: weekly,
      emailFoodLogReminderEnabled: weekly,
    };
  }
  const set = Object.keys(patch).length > 0 ? patch : { userId };
  const [row] = await tx
    .insert(userSettings)
    .values({ ...DEFAULT_USER_SETTINGS, ...patch, userId })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set,
    })
    .returning();
  return row;
}

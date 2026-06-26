import type { UpdateUserSettingsPayload } from "../../contracts/src/settings";
import { settingsRepo } from "../repositories";

export type NotificationSettingKind = "daily_food_log" | "weight_check" | "hydration";

export interface EffectiveSettingsResult {
  global: settingsRepo.GlobalSettings;
  user: settingsRepo.UserSettings;
  effective: {
    pushNotificationsEnabled: boolean;
    dailyFoodLogReminderEnabled: boolean;
    weightCheckReminderEnabled: boolean;
    hydrationReminderEnabled: boolean;
    subscriptionsEnabled: boolean;
    trialsEnabled: boolean;
    purchasesEnabled: boolean;
    cancellationsEnabled: boolean;
    trialDays: number;
  };
}

export async function getGlobalSettings(): Promise<settingsRepo.GlobalSettings> {
  return (await settingsRepo.getGlobalSettings()) ?? settingsRepo.upsertGlobalDefaults();
}

export async function getUserSettings(userId: string): Promise<settingsRepo.UserSettings> {
  return settingsRepo.getOrCreateUserSettings(userId);
}

export async function updateUserSettings(
  userId: string,
  input: UpdateUserSettingsPayload
): Promise<settingsRepo.UserSettings> {
  return settingsRepo.updateUserSettings(userId, input);
}

export async function getEffectiveSettings(userId: string): Promise<EffectiveSettingsResult> {
  const [global, user] = await Promise.all([getGlobalSettings(), getUserSettings(userId)]);

  return {
    global,
    user,
    effective: {
      pushNotificationsEnabled: global.pushNotificationsEnabled && user.pushNotificationsEnabled,
      dailyFoodLogReminderEnabled:
        global.pushNotificationsEnabled &&
        global.dailyFoodLogReminderEnabled &&
        user.pushNotificationsEnabled &&
        user.dailyFoodLogReminderEnabled,
      weightCheckReminderEnabled:
        global.pushNotificationsEnabled &&
        global.weightCheckReminderEnabled &&
        user.pushNotificationsEnabled &&
        user.weightCheckReminderEnabled,
      hydrationReminderEnabled:
        global.pushNotificationsEnabled &&
        global.hydrationReminderEnabled &&
        user.pushNotificationsEnabled &&
        user.hydrationReminderEnabled,
      subscriptionsEnabled: global.subscriptionsEnabled,
      trialsEnabled: global.subscriptionsEnabled && global.trialsEnabled,
      purchasesEnabled: global.subscriptionsEnabled && global.purchasesEnabled,
      cancellationsEnabled: global.subscriptionsEnabled && global.cancellationsEnabled,
      trialDays: global.trialDays,
    },
  };
}

export async function canSendPushNotification(
  userId: string,
  kind: NotificationSettingKind
): Promise<boolean> {
  const settings = await getEffectiveSettings(userId);
  if (kind === "daily_food_log") return settings.effective.dailyFoodLogReminderEnabled;
  if (kind === "weight_check") return settings.effective.weightCheckReminderEnabled;
  return settings.effective.hydrationReminderEnabled;
}

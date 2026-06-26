import { afterEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  getGlobalSettings: vi.fn(),
  upsertGlobalDefaults: vi.fn(),
  getOrCreateUserSettings: vi.fn(),
  updateUserSettings: vi.fn(),
}));

vi.mock("../../src/repositories", () => ({ settingsRepo: repo }));

import {
  canSendPushNotification,
  getEffectiveSettings,
  getGlobalSettings,
  updateUserSettings,
} from "../../src/services/settings.service";

const now = new Date("2026-06-26T00:00:00.000Z");

const globalSettings = {
  key: "default",
  pushNotificationsEnabled: true,
  dailyFoodLogReminderEnabled: true,
  weightCheckReminderEnabled: true,
  hydrationReminderEnabled: true,
  subscriptionsEnabled: true,
  trialsEnabled: true,
  purchasesEnabled: true,
  cancellationsEnabled: true,
  trialDays: 14,
  createdAt: now,
  updatedAt: now,
};

const userSettings = {
  id: "018f6f1e-3d8b-7b30-8b82-bc7c81c1aef2",
  userId: "018f6f1e-3d8b-7b30-8b82-bc7c81c1aef3",
  unitSystem: "metric",
  pushNotificationsEnabled: true,
  dailyFoodLogReminderEnabled: true,
  dailyFoodLogReminderTime: "08:00",
  weightCheckReminderEnabled: true,
  weightCheckReminderDay: "friday",
  weightCheckReminderTime: "09:00",
  hydrationReminderEnabled: true,
  hydrationReminderIntervalMinutes: 40,
  createdAt: now,
  updatedAt: now,
};

describe("settings.service", () => {
  afterEach(() => vi.clearAllMocks());

  it("creates the global default row when it is missing", async () => {
    repo.getGlobalSettings.mockResolvedValue(null);
    repo.upsertGlobalDefaults.mockResolvedValue(globalSettings);

    await expect(getGlobalSettings()).resolves.toEqual(globalSettings);
    expect(repo.upsertGlobalDefaults).toHaveBeenCalledOnce();
  });

  it("resolves effective settings with global settings checked first", async () => {
    repo.getGlobalSettings.mockResolvedValue({
      ...globalSettings,
      pushNotificationsEnabled: false,
      subscriptionsEnabled: false,
    });
    repo.getOrCreateUserSettings.mockResolvedValue(userSettings);

    const settings = await getEffectiveSettings(userSettings.userId);

    expect(settings.effective.pushNotificationsEnabled).toBe(false);
    expect(settings.effective.dailyFoodLogReminderEnabled).toBe(false);
    expect(settings.effective.trialsEnabled).toBe(false);
    expect(settings.effective.purchasesEnabled).toBe(false);
    expect(settings.effective.cancellationsEnabled).toBe(false);
  });

  it("lets user settings block a notification type when global permits it", async () => {
    repo.getGlobalSettings.mockResolvedValue(globalSettings);
    repo.getOrCreateUserSettings.mockResolvedValue({
      ...userSettings,
      hydrationReminderEnabled: false,
    });

    await expect(canSendPushNotification(userSettings.userId, "hydration")).resolves.toBe(false);
    await expect(canSendPushNotification(userSettings.userId, "daily_food_log")).resolves.toBe(
      true
    );
  });

  it("persists partial user settings through the repository", async () => {
    repo.updateUserSettings.mockResolvedValue({ ...userSettings, unitSystem: "imperial" });

    await expect(
      updateUserSettings(userSettings.userId, { unitSystem: "imperial" })
    ).resolves.toEqual(expect.objectContaining({ unitSystem: "imperial" }));
  });
});

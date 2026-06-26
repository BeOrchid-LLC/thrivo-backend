import { describe, expect, it } from "vitest";
import {
  globalSettingsSchema,
  updateUserSettingsPayloadSchema,
  userSettingsSchema,
} from "../../contracts/src";
import {
  DEFAULT_GLOBAL_SETTINGS,
  DEFAULT_USER_SETTINGS,
  GLOBAL_SETTINGS_KEY,
} from "../../src/repositories/settings.repository";

const now = new Date("2026-06-26T00:00:00.000Z");

describe("settings.repository defaults", () => {
  it("defines the single global settings row used by seed and services", () => {
    expect(DEFAULT_GLOBAL_SETTINGS.key).toBe(GLOBAL_SETTINGS_KEY);
    expect(
      globalSettingsSchema.parse({
        ...DEFAULT_GLOBAL_SETTINGS,
        createdAt: now,
        updatedAt: now,
      })
    ).toEqual(
      expect.objectContaining({
        key: "default",
        pushNotificationsEnabled: true,
        subscriptionsEnabled: true,
        trialDays: 14,
      })
    );
  });

  it("defines synced user settings defaults for first read/create", () => {
    expect(
      userSettingsSchema.parse({
        id: "018f6f1e-3d8b-7b30-8b82-bc7c81c1aef2",
        userId: "018f6f1e-3d8b-7b30-8b82-bc7c81c1aef3",
        ...DEFAULT_USER_SETTINGS,
        createdAt: now,
        updatedAt: now,
      })
    ).toEqual(
      expect.objectContaining({
        unitSystem: "metric",
        dailyFoodLogReminderTime: "08:00",
        weightCheckReminderDay: "friday",
        hydrationReminderIntervalMinutes: 40,
      })
    );
  });

  it("accepts partial user settings updates without requiring a full row", () => {
    expect(
      updateUserSettingsPayloadSchema.parse({
        unitSystem: "imperial",
        hydrationReminderIntervalMinutes: 60,
      })
    ).toEqual({
      unitSystem: "imperial",
      hydrationReminderIntervalMinutes: 60,
    });
  });
});

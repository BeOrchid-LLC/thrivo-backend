import { beforeEach, describe, expect, it, vi } from "vitest";

const { pushTokenRepo, notificationDeliveryRepo, enqueue, settingsRepo } = vi.hoisted(() => ({
  pushTokenRepo: { listActiveForFoodLogRemindersPage: vi.fn() },
  notificationDeliveryRepo: { claim: vi.fn(), markFailed: vi.fn() },
  enqueue: vi.fn(),
  settingsRepo: { getGlobalSettings: vi.fn(), upsertGlobalDefaults: vi.fn() },
}));

vi.mock("../../src/repositories", () => ({
  pushTokenRepo,
  notificationDeliveryRepo,
  settingsRepo,
}));
vi.mock("../../src/lib/queue", () => ({
  enqueue,
  QUEUE_NAMES: { nudges: "nudges" },
}));

import {
  localReminderKey,
  sendFoodLogReminders,
} from "../../src/services/food-log-reminder.service";

describe("food-log reminder delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsRepo.getGlobalSettings.mockResolvedValue({
      pushNotificationsEnabled: true,
      dailyFoodLogReminderEnabled: true,
    });
    notificationDeliveryRepo.claim.mockResolvedValue({ id: "delivery-1" });
  });

  it("resolves local date and time using the configured timezone", () => {
    expect(localReminderKey(new Date("2026-01-15T08:00:00.000Z"), "Africa/Lagos")).toEqual({
      localDate: "2026-01-15",
      localTime: "09:00",
    });
  });

  it("skips invalid timezones and enqueues due users once", async () => {
    pushTokenRepo.listActiveForFoodLogRemindersPage
      .mockResolvedValueOnce([
        {
          tokenId: "token-1",
          userId: "user-1",
          expoPushToken: "ExponentPushToken[one]",
          notifyTimes: ["09:00:00"],
          timezone: "Africa/Lagos",
        },
        {
          tokenId: "token-2",
          userId: "user-1",
          expoPushToken: "ExponentPushToken[two]",
          notifyTimes: ["09:00"],
          timezone: "Africa/Lagos",
        },
        {
          tokenId: "token-3",
          userId: "user-2",
          expoPushToken: "ExponentPushToken[bad-zone]",
          notifyTimes: ["09:00"],
          timezone: "Not/AZone",
        },
      ])
      .mockResolvedValueOnce([]);

    await sendFoodLogReminders(new Date("2026-01-15T08:00:00.000Z"));

    expect(notificationDeliveryRepo.claim).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(
      "nudges",
      "send-food-log-reminder",
      expect.objectContaining({
        userId: "user-1",
        localDate: "2026-01-15",
        scheduledTime: "09:00",
        tokens: ["ExponentPushToken[one]", "ExponentPushToken[two]"],
      }),
      expect.any(Object)
    );
  });
});

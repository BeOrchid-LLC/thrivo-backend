import { describe, expect, it } from "vitest";
import {
  errorCodeSchema,
  estimateFoodPayloadSchema,
  foodSearchQuerySchema,
  foodSearchResponseSchema,
  logFoodPayloadSchema,
  foodLogEntrySchema,
  foodRoutes,
  getMeResponseSchema,
  chartResponseSchema,
  metricRoutes,
  progressResponseSchema,
  settingsRoutes,
  subscriptionRoutes,
  weightContextResponseSchema,
  weightEntryResponseSchema,
  purchaseSubscriptionPayloadSchema,
  registerPushPayload,
  updateProfilePayloadSchema,
  updateUserSettingsPayloadSchema,
  userProfileSchema,
  userRoutes,
} from "../../contracts/src";

describe("@beorchid-llc/thrivo-contracts", () => {
  it("validates Expo push registrations and optional installation identity", () => {
    expect(
      registerPushPayload.parse({
        expoPushToken: "ExponentPushToken[device-token]",
        platform: "ios",
        deviceId: "ios:vendor-id",
        notifyTimes: ["08:00", "18:30"],
      })
    ).toEqual({
      expoPushToken: "ExponentPushToken[device-token]",
      platform: "ios",
      deviceId: "ios:vendor-id",
      notifyTimes: ["08:00", "18:30"],
    });

    expect(() =>
      registerPushPayload.parse({
        expoPushToken: "not-an-expo-token",
        platform: "android",
      })
    ).toThrow();
  });

  it("parses the current /users/me success envelope", () => {
    const profile = userProfileSchema.parse({
      id: "018f6f1e-3d8b-7b30-8b82-bc7c81c1aef2",
      email: "test@example.com",
      name: "Test User",
      image: null,
      goal: "lose",
      sex: "female",
      age: 32,
      heightCm: "168.0",
      weightKg: "72.5",
      targetWeightKg: "65.0",
      tdeeKcal: 2100,
      dailyTargetKcal: 1650,
      targetProteinG: 120,
      targetCarbsG: 160,
      targetFatG: 55,
      activityLevel: "light",
      manualDailyTargetKcal: null,
      notifyTimes: ["08:00:00", "12:30:00"],
      timezone: "Africa/Lagos",
      tier: "free",
      accountStatus: "free_trial",
      trialEndsAt: new Date("2026-06-25T00:00:00.000Z"),
      onboardingStep: 3,
      isOnboarded: true,
      isOnboardingSkipped: false,
      createdAt: new Date("2026-06-18T00:00:00.000Z"),
    });

    expect(
      getMeResponseSchema.parse({
        success: true,
        data: profile,
        responseCode: 200,
        message: "Success",
      }).data.email
    ).toBe("test@example.com");
  });

  it("exports stable route metadata and error codes", () => {
    expect(userRoutes.getMe).toEqual({
      method: "GET",
      path: "/api/v1/users/me",
      auth: "user",
    });
    expect(userRoutes.updateProfile).toEqual({
      method: "PATCH",
      path: "/api/v1/users/me/profile",
      auth: "user",
    });
    expect(settingsRoutes.getUserSettings).toEqual({
      method: "GET",
      path: "/api/v1/users/me/settings",
      auth: "user",
    });
    expect(subscriptionRoutes.getMine).toEqual({
      method: "GET",
      path: "/api/v1/subscriptions/me",
      auth: "user",
    });
    expect(foodRoutes.log).toEqual({
      method: "POST",
      path: "/api/v1/foods/log",
      auth: "user",
    });
    expect(metricRoutes.waterDelete).toEqual({
      method: "DELETE",
      path: "/api/v1/metrics/water/:id",
      auth: "user",
    });
    expect(metricRoutes.waterUpdate).toEqual({
      method: "PATCH",
      path: "/api/v1/metrics/water/:id",
      auth: "user",
    });
    expect(metricRoutes.chartGet).toEqual({
      method: "GET",
      path: "/api/v1/metrics/chart",
      auth: "user",
    });
    expect(errorCodeSchema.options).toContain("PREMIUM_REQUIRED");
  });

  it("validates progress, chart, and weight contracts", () => {
    expect(
      progressResponseSchema.parse({
        success: true,
        responseCode: 200,
        message: "Success",
        data: {
          progress: {
            day: "2026-06-28",
            summary: {
              currentWeightKg: 80.7,
              targetWeightKg: 70.3,
              goalGapKg: 10.4,
              currentStreakDays: 14,
              longestStreakDays: 21,
              currentWeekAverageKcal: 1621,
            },
            projection: {
              projectedDate: "2026-11-01",
              projectedMonth: "Nov 2026",
              weeklyRateKg: -0.4,
              status: "on_track",
            },
            calendar: {
              month: "June 2026",
              days: [
                {
                  day: "2026-06-28",
                  dayOfMonth: 28,
                  logged: true,
                  today: true,
                  inMonth: true,
                },
              ],
            },
          },
        },
      }).data.progress.summary.currentStreakDays
    ).toBe(14);

    expect(
      chartResponseSchema.parse({
        success: true,
        responseCode: 200,
        message: "Success",
        data: {
          chart: {
            metric: "weight",
            period: "7d",
            unit: "kg",
            from: "2026-06-22",
            to: "2026-06-28",
            points: [{ date: "2026-06-28", value: 80.7 }],
          },
        },
      }).data.chart.points[0]?.value
    ).toBe(80.7);

    expect(
      weightContextResponseSchema.parse({
        success: true,
        responseCode: 200,
        message: "Success",
        data: {
          context: {
            day: "2026-06-28",
            currentWeightKg: 80.7,
            yesterdayWeightKg: 80.9,
            sevenDayAverageKg: 81.2,
            targetWeightKg: 70.3,
            projection: {
              projectedDate: null,
              projectedMonth: null,
              weeklyRateKg: null,
              status: "not_enough_data",
            },
          },
        },
      }).data.context.day
    ).toBe("2026-06-28");

    expect(
      weightEntryResponseSchema.parse({
        success: true,
        responseCode: 200,
        message: "Success",
        data: {
          entry: {
            id: "018f6f1e-3d8b-7b30-8b82-bc7c81c1aef2",
            day: "2026-06-28",
            weightKg: 80.7,
            recordedAt: "2026-06-28T08:00:00.000Z",
          },
        },
      }).data.entry.weightKg
    ).toBe(80.7);
  });

  it("validates consumed-time food log entries without meal buckets", () => {
    const entry = foodLogEntrySchema.parse({
      id: "log_1",
      foodItemId: null,
      name: "Chicken suya",
      day: "2026-06-27",
      servings: 1,
      servingUnit: "serving",
      source: "manual",
      barcode: null,
      isEstimated: true,
      nutrients: { calories: 270, proteinG: 28, carbsG: 4, fatG: 15 },
      consumedAt: "2026-06-27T12:00:00.000Z",
      loggedAt: "2026-06-27T12:05:00.000Z",
    });

    expect(entry.consumedAt).toBe("2026-06-27T12:00:00.000Z");
    expect("meal" in entry).toBe(false);
    expect(entry.isFavorite).toBe(false);
  });

  it("validates describe-meal estimate payloads", () => {
    expect(
      estimateFoodPayloadSchema.parse({
        name: "Chicken breast, grilled",
        ingredients: "Chicken, pepper",
        cookingMethod: "grilled",
        portionMeasure: "weight",
        quantity: 150,
      }).portionMeasure
    ).toBe("weight");

    expect(
      estimateFoodPayloadSchema.safeParse({
        name: "x".repeat(121),
        portionMeasure: "weight",
        quantity: 150,
      }).success
    ).toBe(false);
  });

  it("validates catalog search pages and external snapshot log payloads", () => {
    const search = foodSearchResponseSchema.parse({
      success: true,
      responseCode: 200,
      message: "Success",
      data: {
        cached: false,
        phase: "local",
        nextCursor: "external:1",
        items: [
          {
            id: "018f6f1e-3d8b-7b30-8b82-bc7c81c1aef2",
            name: "Greek yoghurt",
            brand: "Acme",
            barcode: "1234567890123",
            source: "authoritative",
            servingLabel: "100g",
            servingGrams: 100,
            nutrients: { calories: 90, proteinG: 9, carbsG: 4, fatG: 3 },
            servingOptions: [],
            isPersonal: false,
            isEstimated: false,
            isFavorite: false,
          },
        ],
      },
    });
    expect(search.data.items[0]?.id).toBe("018f6f1e-3d8b-7b30-8b82-bc7c81c1aef2");
    expect(search.data.phase).toBe("local");
    expect(search.data.nextCursor).toBe("external:1");

    const snapshot = {
      externalId: "off:1234567890123",
      name: "Greek yoghurt",
      brand: "Acme",
      barcode: "1234567890123",
      servingLabel: "100g",
      servingGrams: 100,
      nutrients: { calories: 90, proteinG: 9, carbsG: 4, fatG: 3 },
      source: "openfoodfacts" as const,
    };

    expect(
      logFoodPayloadSchema.parse({
        externalFood: snapshot,
        day: "2026-06-28",
        servings: 1,
        servingUnit: "100g",
      }).externalFood?.source
    ).toBe("openfoodfacts");

    expect(
      logFoodPayloadSchema.safeParse({
        foodItemId: "018f6f1e-3d8b-7b30-8b82-bc7c81c1aef2",
        externalFood: snapshot,
        day: "2026-06-28",
        servings: 1,
      }).success
    ).toBe(false);

    expect(foodSearchQuerySchema.safeParse({ q: "ch", limit: 11 }).success).toBe(false);
    expect(foodSearchQuerySchema.parse({ q: "chicken", cursor: "local:10" }).cursor).toBe(
      "local:10"
    );
  });

  it("validates profile update payloads", () => {
    expect(
      updateProfilePayloadSchema.parse({
        firstName: "Ada",
        sex: "prefer_not_to_say",
        activityLevel: "moderate",
        ageYears: 31,
        activationIntent: "start_free_trial",
      }).firstName
    ).toBe("Ada");

    expect(updateProfilePayloadSchema.safeParse({ ageYears: 12 }).success).toBe(false);
  });

  it("validates user settings update payloads", () => {
    expect(
      updateUserSettingsPayloadSchema.parse({
        unitSystem: "imperial",
        dailyFoodLogReminderTime: "08:30",
        hydrationReminderIntervalMinutes: 45,
      })
    ).toEqual({
      unitSystem: "imperial",
      dailyFoodLogReminderTime: "08:30",
      hydrationReminderIntervalMinutes: 45,
    });

    expect(
      updateUserSettingsPayloadSchema.safeParse({ hydrationReminderIntervalMinutes: 3 }).success
    ).toBe(false);
  });

  it("validates subscription payloads", () => {
    expect(purchaseSubscriptionPayloadSchema.parse({ plan: "annual" })).toEqual({
      plan: "annual",
    });
    expect(purchaseSubscriptionPayloadSchema.safeParse({ plan: "weekly" }).success).toBe(false);
  });
});

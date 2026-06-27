import { describe, expect, it } from "vitest";
import {
  errorCodeSchema,
  estimateFoodPayloadSchema,
  foodLogEntrySchema,
  foodRoutes,
  getMeResponseSchema,
  metricRoutes,
  settingsRoutes,
  subscriptionRoutes,
  purchaseSubscriptionPayloadSchema,
  updateProfilePayloadSchema,
  updateUserSettingsPayloadSchema,
  userProfileSchema,
  userRoutes,
} from "../../contracts/src";

describe("@beorchid-llc/thrivo-contracts", () => {
  it("parses the current /users/me success envelope", () => {
    const profile = userProfileSchema.parse({
      id: "018f6f1e-3d8b-7b30-8b82-bc7c81c1aef2",
      email: "test@example.com",
      name: "Test User",
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
    expect(errorCodeSchema.options).toContain("PREMIUM_REQUIRED");
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

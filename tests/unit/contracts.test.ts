import { describe, expect, it } from "vitest";
import {
  errorCodeSchema,
  getMeResponseSchema,
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
      notifyAt: "09:00:00",
      timezone: "Africa/Lagos",
      tier: "free",
      onboardingStep: 3,
      createdAt: new Date("2026-06-18T00:00:00.000Z"),
    });

    expect(getMeResponseSchema.parse({ data: profile }).data.email).toBe("test@example.com");
  });

  it("exports stable route metadata and error codes", () => {
    expect(userRoutes.getMe).toEqual({
      method: "GET",
      path: "/api/v1/users/me",
      auth: "user",
    });
    expect(errorCodeSchema.options).toContain("PREMIUM_REQUIRED");
  });
});

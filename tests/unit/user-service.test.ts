import { afterEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  updateProfile: vi.fn(),
}));
vi.mock("../../src/repositories", () => ({ userRepo: repo }));

import type { User } from "../../src/repositories/user.repository";
import { effectiveAccountStatus, updateUserProfile } from "../../src/services/user.service";

const baseUser = {
  id: "018f6f1e-3d8b-7b30-8b82-bc7c81c1aef2",
  email: "ada@example.com",
  name: "Ada",
  authSubjectId: "sub_1",
  goal: null,
  sex: null,
  age: null,
  heightCm: null,
  weightKg: null,
  targetWeightKg: null,
  tdeeKcal: null,
  dailyTargetKcal: null,
  targetProteinG: null,
  targetCarbsG: null,
  targetFatG: null,
  activityLevel: null,
  manualDailyTargetKcal: null,
  notifyTimes: null,
  timezone: null,
  tier: "free",
  accountStatus: "dormant",
  subscriptionStatus: null,
  trialEndsAt: null,
  onboardingStep: 1,
  deletedAt: null,
  createdAt: new Date("2026-06-18T00:00:00.000Z"),
  updatedAt: new Date("2026-06-18T00:00:00.000Z"),
} as User;

describe("user.service", () => {
  afterEach(() => vi.clearAllMocks());

  it("activates a first-time dormant user into a 7-day free trial", async () => {
    const now = new Date("2026-06-18T12:00:00.000Z");
    repo.updateProfile.mockImplementation(async (_id, patch) => ({ ...baseUser, ...patch }));

    const updated = await updateUserProfile(
      baseUser,
      { activationIntent: "start_free_trial", onboardingStep: 6 },
      now
    );

    expect(repo.updateProfile).toHaveBeenCalledWith(
      baseUser.id,
      expect.objectContaining({
        accountStatus: "free_trial",
        onboardingStep: 6,
      })
    );
    expect(updated.trialEndsAt).toEqual(new Date("2026-06-25T12:00:00.000Z"));
  });

  it("activates on skip while preserving the skipped onboarding step", async () => {
    const now = new Date("2026-06-18T12:00:00.000Z");
    repo.updateProfile.mockImplementation(async (_id, patch) => ({ ...baseUser, ...patch }));

    await updateUserProfile(baseUser, { activationIntent: "skip", onboardingStep: 2 }, now);

    expect(repo.updateProfile).toHaveBeenCalledWith(
      baseUser.id,
      expect.objectContaining({
        accountStatus: "free_trial",
        onboardingStep: 2,
      })
    );
  });

  it("does not restart an existing trial", async () => {
    const trialEndsAt = new Date("2026-06-25T12:00:00.000Z");
    const user = { ...baseUser, accountStatus: "free_trial", trialEndsAt } as User;
    repo.updateProfile.mockImplementation(async (_id, patch) => ({ ...user, ...patch }));

    await updateUserProfile(
      user,
      { activationIntent: "skip" },
      new Date("2026-06-19T00:00:00.000Z")
    );

    expect(repo.updateProfile.mock.calls[0][1]).not.toHaveProperty("trialEndsAt");
    expect(repo.updateProfile.mock.calls[0][1]).not.toHaveProperty("accountStatus");
  });

  it("sends prior-trial dormant users to free_plan on activation", async () => {
    const user = { ...baseUser, trialEndsAt: new Date("2026-06-01T00:00:00.000Z") } as User;
    repo.updateProfile.mockImplementation(async (_id, patch) => ({ ...user, ...patch }));

    await updateUserProfile(user, { activationIntent: "complete" });

    expect(repo.updateProfile.mock.calls[0][1]).toMatchObject({ accountStatus: "free_plan" });
  });

  it("resolves expired free trials as free_plan", () => {
    const user = {
      ...baseUser,
      accountStatus: "free_trial",
      trialEndsAt: new Date("2026-06-01T00:00:00.000Z"),
    } as User;

    expect(effectiveAccountStatus(user, new Date("2026-06-18T00:00:00.000Z"))).toBe("free_plan");
  });
});

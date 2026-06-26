import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repos = vi.hoisted(() => ({
  subscriptionRepo: {
    getByUser: vi.fn(),
    upsertFromWebhook: vi.fn(),
  },
  userRepo: {
    updateProfile: vi.fn(),
    findById: vi.fn(),
  },
}));
const settings = vi.hoisted(() => ({ getEffectiveSettings: vi.fn() }));
const billing = vi.hoisted(() => ({
  billingAdapter: {
    startTrial: vi.fn(),
    purchase: vi.fn(),
    cancel: vi.fn(),
  },
}));
const dbMock = vi.hoisted(() => ({ db: { transaction: vi.fn(async (fn) => fn("tx")) } }));

vi.mock("../../src/repositories", () => repos);
vi.mock("../../src/services/settings.service", () => settings);
vi.mock("../../src/integrations/billing", () => billing);
vi.mock("../../db", () => dbMock);

import {
  cancelSubscription,
  getSubscriptionState,
  purchaseSubscription,
  startTrial,
} from "../../src/services/subscription.service";

const now = new Date("2026-06-26T00:00:00.000Z");
const user = {
  id: "018f6f1e-3d8b-7b30-8b82-bc7c81c1aef2",
  email: "alex@example.com",
  name: "Alex",
  authSubjectId: "sub",
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
  accountStatus: "free_plan",
  subscriptionStatus: null,
  trialEndsAt: null,
  onboardingStep: 7,
  onboardingSkipped: false,
  deletedAt: null,
  createdAt: now,
  updatedAt: now,
};

function activeSubscription(overrides = {}) {
  return {
    id: "018f6f1e-3d8b-7b30-8b82-bc7c81c1aef4",
    userId: user.id,
    rcAppUserId: user.id,
    provider: "app_store",
    productId: "thrivo_premium_monthly",
    status: "active",
    trialEnd: null,
    currentPeriodStart: now,
    currentPeriodEnd: new Date("2026-07-26T00:00:00.000Z"),
    cancelAtPeriodEnd: false,
    lastEventAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("subscription.service", () => {
  beforeEach(() => {
    settings.getEffectiveSettings.mockResolvedValue({
      effective: {
        trialsEnabled: true,
        purchasesEnabled: true,
        cancellationsEnabled: true,
        trialDays: 14,
      },
    });
    billing.billingAdapter.startTrial.mockResolvedValue({
      confirmed: true,
      providerUserId: user.id,
      provider: "app_store",
    });
    billing.billingAdapter.purchase.mockResolvedValue({
      confirmed: true,
      providerUserId: user.id,
      provider: "app_store",
    });
    billing.billingAdapter.cancel.mockResolvedValue({
      confirmed: true,
      providerUserId: user.id,
      provider: "app_store",
    });
    repos.userRepo.findById.mockResolvedValue({ ...user, tier: "premium", accountStatus: "paid" });
    repos.subscriptionRepo.upsertFromWebhook.mockImplementation(async (input) => input);
  });

  afterEach(() => vi.clearAllMocks());

  it("returns a free state for users without a subscription", async () => {
    repos.subscriptionRepo.getByUser.mockResolvedValue(null);

    await expect(getSubscriptionState(user, now)).resolves.toEqual({
      subscription: expect.objectContaining({
        entitlement: "free",
        status: "none",
        trialUsed: false,
        trialDays: 14,
      }),
    });
  });

  it("starts a first trial for 14 days", async () => {
    repos.subscriptionRepo.getByUser.mockResolvedValue(null);

    const result = await startTrial(user, { plan: "monthly" }, now);

    expect(billing.billingAdapter.startTrial).toHaveBeenCalledWith({
      userId: user.id,
      plan: "monthly",
      productId: "thrivo_premium_monthly",
    });
    expect(repos.subscriptionRepo.upsertFromWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "trialing",
        trialEnd: new Date("2026-07-10T00:00:00.000Z"),
      }),
      "tx"
    );
    expect(result.subscription.entitlement).toBe("premium");
  });

  it("purchases an annual subscription for a used-trial free user", async () => {
    repos.subscriptionRepo.getByUser.mockResolvedValue(activeSubscription({ status: "expired" }));

    await purchaseSubscription({ ...user, trialEndsAt: new Date("2026-06-01T00:00:00.000Z") }, { plan: "annual" }, now);

    expect(repos.subscriptionRepo.upsertFromWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: "thrivo_premium_annual",
        status: "active",
        currentPeriodEnd: new Date("2027-06-26T00:00:00.000Z"),
      }),
      "tx"
    );
  });

  it("marks cancellation at period end while preserving current access", async () => {
    const active = activeSubscription();
    repos.subscriptionRepo.getByUser
      .mockResolvedValueOnce(active)
      .mockResolvedValueOnce(
        activeSubscription({
          status: "canceled",
          cancelAtPeriodEnd: true,
        })
      );

    const result = await cancelSubscription({ ...user, tier: "premium" }, {}, now);

    expect(result.subscription).toEqual(
      expect.objectContaining({
        entitlement: "premium",
        status: "canceled",
        cancelAtPeriodEnd: true,
        accessEndsAt: "2026-07-26T00:00:00.000Z",
      })
    );
  });
});

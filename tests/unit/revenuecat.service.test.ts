import { afterEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  LOG_LEVEL: "silent",
  BILLING_PROVIDER: "revenuecat",
  REVENUECAT_SECRET_API_KEY: "rc_secret",
  REVENUECAT_ENTITLEMENT_ID: "Thrivo Premium",
  REVENUECAT_ALLOW_TEST_STORE: true,
  REVENUECAT_PRODUCT_CATALOG: JSON.stringify({
    app_store: { monthly: "thrivo_premium_monthly", annual: "thrivo_premium_annual" },
    play_store: { monthly: "thrivo_premium_monthly", annual: "thrivo_premium_annual" },
    test_store: { monthly: "thrivo_test_monthly", annual: "thrivo_test_annual" },
  }),
}));
const repos = vi.hoisted(() => ({
  userRepo: { findById: vi.fn() },
  subscriptionRepo: { getByUser: vi.fn() },
}));
const subscription = vi.hoisted(() => ({
  getSubscriptionState: vi.fn(),
  persistSubscriptionAndMirror: vi.fn(),
}));

vi.mock("../../src/env", () => ({ env }));
vi.mock("../../src/repositories", () => repos);
vi.mock("../../src/services/subscription.service", () => subscription);

import { syncRevenueCatSubscription } from "../../src/services/revenuecat.service";

const user = { id: "018f6f1e-3d8b-7b30-8b82-bc7c81c1aef2", tier: "premium" } as never;
const completeCatalog = env.REVENUECAT_PRODUCT_CATALOG;

function response(subscriber: unknown, requestDateMs = "1710000000000"): Response {
  return new Response(JSON.stringify({ request_date_ms: requestDateMs, subscriber }), {
    status: 200,
  });
}

describe("RevenueCat server synchronization", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    env.REVENUECAT_PRODUCT_CATALOG = completeCatalog;
  });

  it("downgrades a valid snapshot with no premium entitlement", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          response({ request_date_ms: "1710000000000", entitlements: {}, subscriptions: {} })
        )
    );
    subscription.getSubscriptionState.mockResolvedValue({ subscription: { entitlement: "free" } });
    repos.userRepo.findById.mockResolvedValue({ ...user, tier: "free" });
    repos.subscriptionRepo.getByUser.mockResolvedValue(null);

    await syncRevenueCatSubscription(user, new Date("2026-06-26T00:00:00.000Z"));

    expect(subscription.persistSubscriptionAndMirror).toHaveBeenCalledWith(
      user.id,
      expect.objectContaining({ status: "none", lastSyncedAt: new Date(1710000000000) })
    );
  });

  it("maps a trial entitlement using the snapshot timestamp", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          request_date_ms: "1710000000000",
          entitlements: {
            "Thrivo Premium": {
              product_identifier: "thrivo_premium_monthly",
              purchase_date: "2026-06-20T00:00:00.000Z",
              expires_date: "2026-07-04T00:00:00.000Z",
            },
          },
          subscriptions: {
            thrivo_premium_monthly: {
              product_identifier: "thrivo_premium_monthly",
              period_type: "TRIAL",
              store: "APP_STORE",
              purchase_date: "2026-06-20T00:00:00.000Z",
              expires_date: "2026-07-04T00:00:00.000Z",
            },
          },
        })
      )
    );
    subscription.getSubscriptionState.mockResolvedValue({
      subscription: { entitlement: "premium" },
    });
    repos.userRepo.findById.mockResolvedValue({ ...user, tier: "premium" });

    await syncRevenueCatSubscription(user, new Date("2026-06-26T00:00:00.000Z"));

    expect(subscription.persistSubscriptionAndMirror).toHaveBeenCalledWith(
      user.id,
      expect.objectContaining({
        status: "trialing",
        productId: "thrivo_premium_monthly",
        lastSyncedAt: new Date(1710000000000),
      })
    );
  });

  it("does not mutate access when RevenueCat returns a malformed premium snapshot", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          entitlements: { "Thrivo Premium": { product_identifier: "missing-product" } },
        })
      )
    );

    await expect(syncRevenueCatSubscription(user)).rejects.toThrow(
      "incomplete premium entitlement"
    );
    expect(subscription.persistSubscriptionAndMirror).not.toHaveBeenCalled();
  });

  it("maps a Test Store entitlement to the test_store provider", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          entitlements: {
            "Thrivo Premium": {
              product_identifier: "thrivo_test_monthly",
              purchase_date: "2026-06-20T00:00:00.000Z",
              expires_date: "2026-07-04T00:00:00.000Z",
            },
          },
          subscriptions: {
            thrivo_test_monthly: {
              product_identifier: "thrivo_test_monthly",
              period_type: "TRIAL",
              store: "TEST_STORE",
              purchase_date: "2026-06-20T00:00:00.000Z",
              expires_date: "2026-07-04T00:00:00.000Z",
            },
          },
        })
      )
    );
    subscription.getSubscriptionState.mockResolvedValue({
      subscription: { entitlement: "premium" },
    });
    repos.userRepo.findById.mockResolvedValue({ ...user, tier: "premium" });

    await syncRevenueCatSubscription(user, new Date("2026-06-26T00:00:00.000Z"));

    expect(subscription.persistSubscriptionAndMirror).toHaveBeenCalledWith(
      user.id,
      expect.objectContaining({
        provider: "test_store",
        status: "trialing",
        productId: "thrivo_test_monthly",
      })
    );
  });

  it("does not mutate access when the Test Store catalog is missing", async () => {
    env.REVENUECAT_PRODUCT_CATALOG = JSON.stringify({
      app_store: { monthly: "thrivo_premium_monthly", annual: "thrivo_premium_annual" },
      play_store: { monthly: "thrivo_premium_monthly", annual: "thrivo_premium_annual" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          entitlements: {
            "Thrivo Premium": {
              product_identifier: "thrivo_test_monthly",
              purchase_date: "2026-06-20T00:00:00.000Z",
              expires_date: "2026-07-04T00:00:00.000Z",
            },
          },
          subscriptions: {
            thrivo_test_monthly: {
              product_identifier: "thrivo_test_monthly",
              period_type: "NORMAL",
              store: "TEST_STORE",
              purchase_date: "2026-06-20T00:00:00.000Z",
              expires_date: "2026-07-04T00:00:00.000Z",
            },
          },
        })
      )
    );

    await expect(syncRevenueCatSubscription(user)).rejects.toThrow(
      "Test Store product catalog is not configured"
    );
    expect(subscription.persistSubscriptionAndMirror).not.toHaveBeenCalled();
  });

  it("rejects Test Store reconciliation when the opt-in flag is disabled", async () => {
    env.REVENUECAT_ALLOW_TEST_STORE = false;
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          response({
            entitlements: {
              "Thrivo Premium": {
                product_identifier: "thrivo_test_monthly",
                purchase_date: "2026-06-20T00:00:00.000Z",
                expires_date: "2026-07-04T00:00:00.000Z",
              },
            },
            subscriptions: {
              thrivo_test_monthly: {
                product_identifier: "thrivo_test_monthly",
                period_type: "NORMAL",
                store: "TEST_STORE",
                purchase_date: "2026-06-20T00:00:00.000Z",
                expires_date: "2026-07-04T00:00:00.000Z",
              },
            },
          })
        )
      );

      await expect(syncRevenueCatSubscription(user)).rejects.toThrow("unsupported store");
      expect(subscription.persistSubscriptionAndMirror).not.toHaveBeenCalled();
    } finally {
      env.REVENUECAT_ALLOW_TEST_STORE = true;
    }
  });

  it("rejects an invalid authoritative snapshot timestamp without writing", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(response({ entitlements: {}, subscriptions: {} }, "not-a-timestamp"))
    );

    await expect(syncRevenueCatSubscription(user)).rejects.toThrow("request_date_ms is invalid");
    expect(subscription.persistSubscriptionAndMirror).not.toHaveBeenCalled();
  });
});

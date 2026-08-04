import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app";
import { subscriptionRepo, userRepo } from "../../src/repositories";
import { authed, createSession } from "../helpers/auth";
import { closeDb, resetDb } from "../helpers/db";

const run = process.env.RUN_DB_TESTS === "1";

describe.skipIf(!run)("integration: subscriptions", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeDb();
  });

  it("requires auth for subscription state", async () => {
    const res = await buildApp().request("/api/v1/subscriptions/me");
    expect(res.status).toBe(401);
  });

  it("returns a free subscription state for a new user", async () => {
    const app = buildApp();
    const session = await createSession();

    const res = await app.request("/api/v1/subscriptions/me", { headers: authed(session) });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { subscription: { status: string } } };
    expect(body.data.subscription.status).toBe("none");
  });

  it("shows a cancel-at-period-end subscription as canceled with access retained", async () => {
    const app = buildApp();
    const session = await createSession();
    const user = await userRepo.findActiveByEmail(session.email);
    expect(user).not.toBeNull();
    const now = Date.now();

    await subscriptionRepo.upsertFromWebhook({
      userId: user!.id,
      provider: "app_store",
      productId: "thrivo_premium_monthly",
      status: "canceled",
      currentPeriodStart: new Date(now - 24 * 60 * 60 * 1000),
      currentPeriodEnd: new Date(now + 30 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: true,
    });
    await userRepo.updateProfile(user!.id, {
      tier: "premium",
      accountStatus: "paid",
      subscriptionStatus: "canceled",
    });

    const res = await app.request("/api/v1/subscriptions/me", { headers: authed(session) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { subscription: { status: string; entitlement: string; cancelAtPeriodEnd: boolean } };
    };
    expect(body.data.subscription).toEqual(
      expect.objectContaining({
        status: "canceled",
        entitlement: "premium",
        cancelAtPeriodEnd: true,
      })
    );
  });
});

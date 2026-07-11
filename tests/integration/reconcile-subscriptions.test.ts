import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { handleReconcileSubscriptions } from "../../src/jobs/handlers/reconcile-subscriptions";
import { subscriptionRepo, userRepo } from "../../src/repositories";
import { makeUser } from "../helpers/factories";
import { closeDb, resetDb } from "../helpers/db";

// Integration suite — runs against a real test Postgres with migrations applied
// (globalSetup). Gated so `npm run test:unit` stays green without infra; enable
// with RUN_DB_TESTS=1.
const run = process.env.RUN_DB_TESTS === "1";

describe.skipIf(!run)("integration: reconcile-subscriptions job", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeDb();
  });

  it("downgrades a trial whose period ended after a dropped EXPIRATION webhook (I4)", async () => {
    const user = await makeUser({ tier: "premium", accountStatus: "free_trial" });
    const trialEnd = new Date(Date.now() - 60_000);
    await subscriptionRepo.upsertFromWebhook({
      userId: user.id,
      provider: "app_store",
      productId: "thrivo_premium_monthly",
      status: "trialing",
      trialEnd,
      currentPeriodStart: new Date(Date.now() - 14 * 24 * 3600 * 1000),
      currentPeriodEnd: trialEnd, // RevenueCat mirrors trial end onto current_period_end
      cancelAtPeriodEnd: false,
      lastEventAt: new Date(Date.now() - 14 * 24 * 3600 * 1000),
    });

    await handleReconcileSubscriptions({} as never);

    const sub = await subscriptionRepo.getByUser(user.id);
    expect(sub!.status).toBe("expired");
    const after = await userRepo.findById(user.id);
    expect(after!.tier).toBe("free");
  });

  it("leaves an in-progress trial untouched and still visible to the reminder sweep", async () => {
    const user = await makeUser({ tier: "premium", accountStatus: "free_trial" });
    const trialEnd = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    await subscriptionRepo.upsertFromWebhook({
      userId: user.id,
      provider: "app_store",
      productId: "thrivo_premium_monthly",
      status: "trialing",
      trialEnd,
      currentPeriodStart: new Date(),
      currentPeriodEnd: trialEnd,
      cancelAtPeriodEnd: false,
      lastEventAt: new Date(),
    });

    await handleReconcileSubscriptions({} as never);

    const sub = await subscriptionRepo.getByUser(user.id);
    expect(sub!.status).toBe("trialing");
    const after = await userRepo.findById(user.id);
    expect(after!.tier).toBe("premium");

    const upcoming = await subscriptionRepo.listTrialsEndingWithin(
      new Date(),
      new Date(Date.now() + 7 * 24 * 3600 * 1000)
    );
    expect(upcoming.map((s) => s.userId)).toContain(user.id);
  });

  it("still expires non-trial live statuses whose period has ended", async () => {
    const user = await makeUser({ tier: "premium", accountStatus: "paid" });
    const periodEnd = new Date(Date.now() - 60_000);
    await subscriptionRepo.upsertFromWebhook({
      userId: user.id,
      provider: "app_store",
      productId: "thrivo_premium_monthly",
      status: "past_due",
      currentPeriodStart: new Date(Date.now() - 30 * 24 * 3600 * 1000),
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      lastEventAt: new Date(Date.now() - 30 * 24 * 3600 * 1000),
    });

    await handleReconcileSubscriptions({} as never);

    const sub = await subscriptionRepo.getByUser(user.id);
    expect(sub!.status).toBe("expired");
    const after = await userRepo.findById(user.id);
    expect(after!.tier).toBe("free");
  });
});

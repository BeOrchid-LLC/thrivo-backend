import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import { createSession } from "../helpers/auth";
import { makeCheckIn, makeFoodLog, makeWeightEntry } from "../helpers/factories";
import { buildApp } from "../../src/app";
import { signAdminSession, ADMIN_COOKIE } from "../../src/admin/session.service";
import {
  adminUserActivityResponseSchema,
  adminUserDetailResponseSchema,
  adminUserTimelineResponseSchema,
} from "../../contracts/src/admin";
import { subscriptionEventRepo, subscriptionRepo, userRepo } from "../../src/repositories";

const run = process.env.RUN_DB_TESTS === "1";

async function adminCookie(): Promise<string> {
  const token = await signAdminSession({
    id: "admin@test.thrivo.fit",
    email: "admin@test.thrivo.fit",
    name: null,
    role: "admin",
  });
  return `${ADMIN_COOKIE}=${token}`;
}

describe.skipIf(!run)("integration: admin user detail", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeDb();
  });

  it("GET /admin/users/:id returns the extended shape with null extras for a fresh, zero-activity user", async () => {
    const app = buildApp();
    const session = await createSession();
    const user = await userRepo.findActiveByEmail(session.email);
    expect(user).not.toBeNull();

    const res = await app.request(`/api/v1/admin/users/${user!.id}`, {
      headers: { Cookie: await adminCookie() },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { data: unknown };
    const parsed = adminUserDetailResponseSchema.safeParse(body.data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.user.device).toBeNull();
      expect(parsed.data.user.convertedViaTrigger).toBeNull();
      expect(parsed.data.user.subscription).toBeNull();
      expect(parsed.data.user.stats).toEqual({
        currentStreakDays: 0,
        totalFoodLogs: 0,
        totalWeightLogs: 0,
        totalCheckIns: 0,
        avgDailyKcal: null,
      });
    }
  });

  it("GET /admin/users/:id surfaces revenue-to-date and trial dates derived from subscription_events", async () => {
    const app = buildApp();
    const session = await createSession();
    const user = await userRepo.findActiveByEmail(session.email);

    await subscriptionRepo.upsertFromWebhook({
      userId: user!.id,
      provider: "app_store",
      status: "active",
      productId: "thrivo_premium_monthly",
      currentPeriodEnd: new Date("2026-07-21T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      rcAppUserId: "rcusr_test",
    });
    await subscriptionEventRepo.insert({
      userId: user!.id,
      eventType: "trial_started",
      occurredAt: new Date("2026-06-14T00:00:00.000Z"),
    });
    await subscriptionEventRepo.insert({
      userId: user!.id,
      eventType: "trial_converted",
      occurredAt: new Date("2026-06-21T00:00:00.000Z"),
      priceAmountCents: 1499,
      currency: "USD",
    });

    const res = await app.request(`/api/v1/admin/users/${user!.id}`, {
      headers: { Cookie: await adminCookie() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { user: { subscription: Record<string, unknown> } };
    };
    expect(body.data.user.subscription).toMatchObject({
      trialStartedAt: "2026-06-14T00:00:00.000Z",
      trialConvertedAt: "2026-06-21T00:00:00.000Z",
      firstChargeAmountCents: 1499,
      revenueToDateCents: 1499,
      rcAppUserId: "rcusr_test",
      stripeCustomerId: null,
    });
  });

  it("GET /admin/users/:id/timeline orders account_created before a later trial_started, and 404s for an unknown user", async () => {
    const app = buildApp();
    const session = await createSession();
    const user = await userRepo.findActiveByEmail(session.email);
    const cookie = await adminCookie();

    const trialStartedAt = new Date(user!.createdAt.getTime() + 1_000);
    await subscriptionEventRepo.insert({
      userId: user!.id,
      eventType: "trial_started",
      occurredAt: trialStartedAt,
    });

    const res = await app.request(`/api/v1/admin/users/${user!.id}/timeline`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown };
    const parsed = adminUserTimelineResponseSchema.safeParse(body.data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.timeline.map((e) => e.type)).toEqual(["account_created", "trial_started"]);
    }

    const missing = await app.request(
      "/api/v1/admin/users/00000000-0000-0000-0000-000000000000/timeline",
      { headers: { Cookie: cookie } }
    );
    expect(missing.status).toBe(404);
  });

  it("GET /admin/users/:id/activity returns correctly-shaped pages for all 3 types and rejects a bad type with 422", async () => {
    const app = buildApp();
    const session = await createSession();
    const user = await userRepo.findActiveByEmail(session.email);
    const cookie = await adminCookie();

    await makeFoodLog(user!.id);
    await makeCheckIn(user!.id);
    await makeWeightEntry(user!.id);

    for (const type of ["food_logs", "check_ins", "weight_logs"] as const) {
      const res = await app.request(`/api/v1/admin/users/${user!.id}/activity?type=${type}`, {
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: unknown };
      const parsed = adminUserActivityResponseSchema.safeParse(body.data);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.items).toHaveLength(1);
        expect(parsed.data.total).toBe(1);
      }
    }

    const bad = await app.request(`/api/v1/admin/users/${user!.id}/activity?type=not_a_type`, {
      headers: { Cookie: cookie },
    });
    expect(bad.status).toBe(422);
  });

  it("rejects unauthenticated requests on all 3 user-detail routes", async () => {
    const app = buildApp();
    const id = "00000000-0000-0000-0000-000000000000";
    for (const path of [
      `/api/v1/admin/users/${id}`,
      `/api/v1/admin/users/${id}/timeline`,
      `/api/v1/admin/users/${id}/activity?type=food_logs`,
    ]) {
      const res = await app.request(path);
      expect(res.status).toBe(401);
    }
  });
});

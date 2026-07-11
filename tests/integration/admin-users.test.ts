import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import { createSession } from "../helpers/auth";
import { makeFoodLog } from "../helpers/factories";
import { buildApp } from "../../src/app";
import { db } from "../../db";
import { env } from "../../src/env";
import { adminAuditLog } from "../../db/schema";
import { signAdminSession, ADMIN_COOKIE } from "../../src/admin/session.service";
import { streakRepo, subscriptionRepo, userRepo } from "../../src/repositories";

const run = process.env.RUN_DB_TESTS === "1";

// A real admin-SPA fetch always carries Origin; the adminOriginGuard (R3-3)
// rejects a cookie-authed unsafe-method request that has none. Legitimate
// mutating requests in these tests must send the allowed origin, matching the
// browser (see admin-auth.test.ts).
const ALLOWED_ORIGIN = env.CORS_ORIGINS[0] ?? "http://localhost:3001";

async function adminCookie(): Promise<string> {
  const token = await signAdminSession({
    id: "admin@test.thrivo.fit",
    email: "admin@test.thrivo.fit",
    name: null,
    role: "admin",
  });
  return `${ADMIN_COOKIE}=${token}`;
}

type AdminUserPayload = Record<string, unknown>;

function expectFullAdminUser(user: AdminUserPayload) {
  const expectedKeys = [
    "id",
    "email",
    "name",
    "goal",
    "sex",
    "age",
    "heightCm",
    "weightKg",
    "targetWeightKg",
    "tdeeKcal",
    "dailyTargetKcal",
    "targetProteinG",
    "targetCarbsG",
    "targetFatG",
    "activityLevel",
    "manualDailyTargetKcal",
    "notifyTimes",
    "timezone",
    "tier",
    "accountStatus",
    "trialEndsAt",
    "onboardingStep",
    "isOnboarded",
    "isOnboardingSkipped",
    "onboardingSkipped",
    "createdAt",
    "updatedAt",
    "deletedAt",
    "subscriptionStatus",
    "status",
    "lastActiveAt",
    "totalFoodLogs",
    "currentStreakDays",
    "subscription",
  ];

  for (const key of expectedKeys) {
    expect(user).toHaveProperty(key);
  }
  expect(user).not.toHaveProperty("authSubjectId");
}

describe.skipIf(!run)("integration: admin users", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeDb();
  });

  it("returns full user records on GET /admin/users and GET /admin/users/:id", async () => {
    const app = buildApp();
    const session = await createSession();
    const user = await userRepo.findActiveByEmail(session.email);
    expect(user).not.toBeNull();

    await userRepo.updateProfile(user!.id, {
      goal: "lose",
      sex: "female",
      age: 32,
      heightCm: "168.0",
      weightKg: "72.5",
      targetWeightKg: "68.0",
      tdeeKcal: 2100,
      dailyTargetKcal: 1800,
      targetProteinG: 120,
      targetCarbsG: 180,
      targetFatG: 55,
      activityLevel: "moderate",
      manualDailyTargetKcal: null,
      notifyTimes: ["08:00:00"],
      timezone: "Africa/Lagos",
      tier: "premium",
      accountStatus: "paid",
      onboardingStep: 3,
      onboardingSkipped: true,
    });

    await makeFoodLog(user!.id);
    await makeFoodLog(user!.id);
    await streakRepo.upsertStreak({
      userId: user!.id,
      currentStreak: 5,
      longestStreak: 12,
      lastLoggedDate: "2026-06-10",
    });
    await subscriptionRepo.upsertFromWebhook({
      userId: user!.id,
      provider: "app_store",
      status: "active",
      productId: "thrivo_monthly",
      currentPeriodEnd: new Date("2026-07-02T09:12:00.000Z"),
      cancelAtPeriodEnd: false,
    });

    const cookie = await adminCookie();
    const listRes = await app.request("/api/v1/admin/users?page=1&pageSize=20", {
      headers: { Cookie: cookie },
    });
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      success: boolean;
      data: { items: AdminUserPayload[] };
    };
    expect(listBody.success).toBe(true);
    const listUser = listBody.data.items.find((item) => item.id === user!.id);
    expect(listUser).toBeDefined();
    expectFullAdminUser(listUser!);
    expect(listUser!.onboardingStep).toBe(3);
    expect(listUser!.onboardingSkipped).toBe(true);
    expect(listUser!.isOnboarded).toBe(false);
    expect(listUser!.isOnboardingSkipped).toBe(true);
    expect(listUser!.totalFoodLogs).toBe(2);
    expect(listUser!.currentStreakDays).toBe(5);
    expect(listUser!.subscription).toMatchObject({
      status: "active",
      priceLabel: "thrivo_monthly",
      cancelAtPeriodEnd: false,
    });

    const detailRes = await app.request(`/api/v1/admin/users/${user!.id}`, {
      headers: { Cookie: cookie },
    });
    expect(detailRes.status).toBe(200);
    const detailBody = (await detailRes.json()) as {
      success: boolean;
      data: { user: AdminUserPayload };
    };
    expect(detailBody.success).toBe(true);
    expectFullAdminUser(detailBody.data.user);
    expect(detailBody.data.user).toMatchObject({
      id: listUser!.id,
      email: listUser!.email,
      onboardingStep: 3,
      onboardingSkipped: true,
      totalFoodLogs: 2,
      currentStreakDays: 5,
    });
  });

  it("hard-deletes a user via DELETE /admin/users/:id with a JSON ack envelope, and writes exactly one audit row (R3-1)", async () => {
    const app = buildApp();
    const session = await createSession();

    const user = await userRepo.findActiveByEmail(session.email);
    expect(user).not.toBeNull();

    const del = await app.request(`/api/v1/admin/users/${user!.id}`, {
      method: "DELETE",
      headers: { Cookie: await adminCookie(), Origin: ALLOWED_ORIGIN },
    });

    expect(del.status).toBe(200);
    const body = (await del.json()) as { success: boolean; data: null; message: string };
    expect(body.success).toBe(true);
    expect(body.data).toBeNull();
    expect(body.message).toBe("User deleted permanently");
    expect(await userRepo.findActiveByEmail(session.email)).toBeNull();

    const auditRows = await db
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.targetId, user!.id));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      actorAdminEmail: "admin@test.thrivo.fit",
      action: "user.hard_delete",
      targetType: "user",
      targetId: user!.id,
    });
    expect((auditRows[0]!.before as { email: string }).email).toBe(session.email);
  });

  it("deleting a nonexistent user is a no-op ack and writes no audit row (rollback-equivalent)", async () => {
    const app = buildApp();
    const missingId = "00000000-0000-0000-0000-000000000000";

    const del = await app.request(`/api/v1/admin/users/${missingId}`, {
      method: "DELETE",
      headers: { Cookie: await adminCookie(), Origin: ALLOWED_ORIGIN },
    });

    expect(del.status).toBe(200);
    const auditRows = await db
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.targetId, missingId));
    expect(auditRows).toHaveLength(0);
  });

  it("returns dashboard metrics via GET /admin/metrics/dashboard", async () => {
    const app = buildApp();
    const session = await createSession();
    // DAU/MAU read last_active_at, so mark the seeded user active for the metric.
    const user = await userRepo.findActiveByEmail(session.email);
    if (user) await userRepo.touchLastActive(user.id);

    const res = await app.request("/api/v1/admin/metrics/dashboard", {
      headers: { Cookie: await adminCookie() },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        metrics: {
          mrrCents: number;
          activeSubscribers: number;
          dau: number;
          mau: number;
          churnRate: number;
          subscriberGrowth: Array<{ date: string; value: number }>;
        };
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.metrics.mau).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.data.metrics.subscriberGrowth)).toBe(true);
  });
});

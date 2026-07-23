import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import { buildApp } from "../../src/app";
import { db } from "../../db";
import { env } from "../../src/env";
import { adminAuditLog } from "../../db/schema";
import { makeAdminUser, makeUser } from "../helpers/factories";
import { subscriptionRepo, userRepo } from "../../src/repositories";

const run = process.env.RUN_DB_TESTS === "1";
const ALLOWED_ORIGIN = env.CORS_ORIGINS[0] ?? "http://localhost:3001";

function adminBearer() {
  return "Bearer test-clerk-admin-token:test_admin:admin@test.thrivo.fit";
}

describe.skipIf(!run)("integration: admin subscription actions", () => {
  beforeEach(async () => {
    await resetDb();
    await makeAdminUser("admin@test.thrivo.fit", "admin");
  });
  afterAll(async () => {
    await closeDb();
  });

  it("cancels an active subscription, mirrors the projection, and audits it", async () => {
    const app = buildApp();
    const user = await makeUser({ tier: "premium" });
    await subscriptionRepo.upsertFromWebhook({
      userId: user.id,
      provider: "app_store",
      status: "active",
      productId: "thrivo_premium_monthly",
      currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      rcAppUserId: "rcusr_test",
    });

    const res = await app.request(`/api/v1/admin/users/${user.id}/subscription/cancel`, {
      method: "POST",
      headers: {
        authorization: adminBearer(),
        Origin: ALLOWED_ORIGIN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reason: "customer request" }),
    });
    expect(res.status).toBe(200);

    const sub = await subscriptionRepo.getByUser(user.id);
    expect(sub?.status).toBe("canceled");
    expect(sub?.cancelAtPeriodEnd).toBe(true);

    const audit = await db
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, "subscription.admin_cancel"));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ targetType: "user", targetId: user.id });
  });

  it("cancelling a user with no subscription is a 409 conflict", async () => {
    const app = buildApp();
    const user = await makeUser();
    const res = await app.request(`/api/v1/admin/users/${user.id}/subscription/cancel`, {
      method: "POST",
      headers: {
        authorization: adminBearer(),
        Origin: ALLOWED_ORIGIN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reason: "n/a" }),
    });
    expect(res.status).toBe(409);
  });

  it("records a refund decision as an audit row without moving money", async () => {
    const app = buildApp();
    const user = await makeUser({ tier: "premium" });

    const res = await app.request(`/api/v1/admin/users/${user.id}/subscription/refund`, {
      method: "POST",
      headers: {
        authorization: adminBearer(),
        Origin: ALLOWED_ORIGIN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amountCents: 1499, reason: "goodwill" }),
    });
    expect(res.status).toBe(200);

    const audit = await db
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, "subscription.admin_refund"));
    expect(audit).toHaveLength(1);
    expect((audit[0]!.after as { amountCents: number }).amountCents).toBe(1499);

    // Entitlement is untouched — refund is store-side, this only records intent.
    const stillPremium = await userRepo.findById(user.id);
    expect(stillPremium?.tier).toBe("premium");
  });
});

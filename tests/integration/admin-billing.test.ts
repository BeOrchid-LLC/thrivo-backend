import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import { buildApp } from "../../src/app";
import { db } from "../../db";
import { env } from "../../src/env";
import { adminAuditLog, webhookEvents } from "../../db/schema";
import { makeAdminUser } from "../helpers/factories";
import { subscriptionEventRepo } from "../../src/repositories";
import { makeUser } from "../helpers/factories";
import {
  adminSubscriptionEventListResponseSchema,
  adminUserBillingEventsResponseSchema,
  adminWebhookEventDetailResponseSchema,
  adminWebhookEventListResponseSchema,
} from "../../contracts/src";

const run = process.env.RUN_DB_TESTS === "1";
const ALLOWED_ORIGIN = env.CORS_ORIGINS[0] ?? "http://localhost:3001";

function bearerFor(role: "admin" | "support" | "read-only") {
  return `Bearer test-clerk-token:test_${role.replace(/-/g, "")}:${role}@test.thrivo.fit`;
}

describe.skipIf(!run)("integration: admin billing observability", () => {
  beforeEach(async () => {
    await resetDb();
    await Promise.all([
      makeAdminUser("admin@test.thrivo.fit", "admin"),
      makeAdminUser("support@test.thrivo.fit", "support"),
      makeAdminUser("read-only@test.thrivo.fit", "read-only"),
    ]);
  });
  afterAll(async () => {
    await closeDb();
  });

  it("lists subscription events and a user's own timeline", async () => {
    const user = await makeUser();
    await subscriptionEventRepo.insert({
      userId: user.id,
      eventType: "trial_started",
      occurredAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    await subscriptionEventRepo.insert({
      userId: user.id,
      eventType: "trial_converted",
      occurredAt: new Date("2026-07-08T00:00:00.000Z"),
      priceAmountCents: 1499,
      currency: "USD",
    });

    const app = buildApp();
    const list = await app.request("/api/v1/admin/billing/events?limit=50", {
      headers: { authorization: bearerFor("read-only") },
    });
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { data: unknown };
    const parsedList = adminSubscriptionEventListResponseSchema.safeParse(listBody.data);
    expect(parsedList.success).toBe(true);
    if (parsedList.success) expect(parsedList.data.items.length).toBe(2);

    const perUser = await app.request(`/api/v1/admin/users/${user.id}/billing-events`, {
      headers: { authorization: bearerFor("read-only") },
    });
    const perUserBody = (await perUser.json()) as { data: unknown };
    expect(adminUserBillingEventsResponseSchema.safeParse(perUserBody.data).success).toBe(true);
  });

  it("gates the raw webhook payload to admin (support gets 403)", async () => {
    const [wh] = await db
      .insert(webhookEvents)
      .values({ provider: "revenuecat", eventId: "evt_1", payload: { type: "INITIAL_PURCHASE" } })
      .returning();
    const app = buildApp();

    const listRes = await app.request("/api/v1/admin/webhooks", {
      headers: { authorization: bearerFor("support") },
    });
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { data: unknown };
    expect(adminWebhookEventListResponseSchema.safeParse(listBody.data).success).toBe(true);

    const supportDetail = await app.request(`/api/v1/admin/webhooks/${wh.id}`, {
      headers: { authorization: bearerFor("support") },
    });
    expect(supportDetail.status).toBe(403);

    const adminDetail = await app.request(`/api/v1/admin/webhooks/${wh.id}`, {
      headers: { authorization: bearerFor("admin") },
    });
    expect(adminDetail.status).toBe(200);
    const adminBody = (await adminDetail.json()) as { data: unknown };
    expect(adminWebhookEventDetailResponseSchema.safeParse(adminBody.data).success).toBe(true);
  });

  it("reconcile trigger is admin-only and audited", async () => {
    const user = await makeUser();
    const app = buildApp();

    const support = await app.request(`/api/v1/admin/users/${user.id}/reconcile-subscription`, {
      method: "POST",
      headers: { authorization: bearerFor("support"), Origin: ALLOWED_ORIGIN },
    });
    expect(support.status).toBe(403);

    const admin = await app.request(`/api/v1/admin/users/${user.id}/reconcile-subscription`, {
      method: "POST",
      headers: { authorization: bearerFor("admin"), Origin: ALLOWED_ORIGIN },
    });
    expect(admin.status).toBe(202);

    const audit = await db
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, "subscription.reconcile_triggered"));
    expect(audit).toHaveLength(1);
  });
});

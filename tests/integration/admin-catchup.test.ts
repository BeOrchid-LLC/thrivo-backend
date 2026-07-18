import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import { buildApp } from "../../src/app";
import { db } from "../../db";
import { emailLogs } from "../../db/schema";
import { signAdminSession, ADMIN_COOKIE } from "../../src/admin/session.service";
import {
  adminEmailLogSchema,
  adminAuditLogEntrySchema,
  adminEngagementAnalyticsResponseSchema,
  adminPaginated,
  adminSubscriptionAnalyticsResponseSchema,
  adminSubscriptionRowSchema,
} from "../../contracts/src";

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

async function getData(path: string): Promise<{ status: number; data: unknown }> {
  const app = buildApp();
  const res = await app.request(`/api/v1/admin${path}`, {
    headers: { cookie: await adminCookie() },
  });
  const body = (await res.json()) as { data: unknown };
  return { status: res.status, data: body.data };
}

describe.skipIf(!run)("integration: admin Phase-0 catch-up endpoints", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeDb();
  });

  it("GET /admin/subscriptions returns the offset-paginated contract shape", async () => {
    const { status, data } = await getData("/subscriptions?page=1&pageSize=10");
    expect(status).toBe(200);
    expect(adminPaginated(adminSubscriptionRowSchema).safeParse(data).success).toBe(true);
  });

  it("GET /admin/subscriptions?status=none is always empty (no such row state)", async () => {
    const { status, data } = await getData("/subscriptions?status=none");
    expect(status).toBe(200);
    const parsed = adminPaginated(adminSubscriptionRowSchema).safeParse(data);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.items).toHaveLength(0);
  });

  it("GET /admin/analytics/subscriptions conforms to the shared contract", async () => {
    const { status, data } = await getData("/analytics/subscriptions");
    expect(status).toBe(200);
    const parsed = adminSubscriptionAnalyticsResponseSchema.safeParse(data);
    expect(parsed.success).toBe(true);
    // No priced events / snapshots on a fresh DB — stubbed to 0, not faked.
    if (parsed.success) {
      expect(parsed.data.analytics.mrrCents).toBe(0);
      expect(parsed.data.analytics.upgradeTriggers).toEqual([]);
    }
  });

  it("GET /admin/analytics/engagement conforms to the shared contract", async () => {
    const { status, data } = await getData("/analytics/engagement");
    expect(status).toBe(200);
    expect(adminEngagementAnalyticsResponseSchema.safeParse(data).success).toBe(true);
  });

  it("GET /admin/email-logs maps toEmail->to and delivered->sent", async () => {
    await db.insert(emailLogs).values({
      toEmail: "user@test.thrivo.fit",
      template: "welcome",
      status: "delivered",
    });
    const { status, data } = await getData("/email-logs?page=1&pageSize=10");
    expect(status).toBe(200);
    const parsed = adminPaginated(adminEmailLogSchema).safeParse(data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.items[0]?.to).toBe("user@test.thrivo.fit");
      expect(parsed.data.items[0]?.status).toBe("sent");
    }
  });

  it("GET /admin/audit-log returns the offset-paginated contract shape", async () => {
    const { status, data } = await getData("/audit-log?page=1&pageSize=10");
    expect(status).toBe(200);
    expect(adminPaginated(adminAuditLogEntrySchema).safeParse(data).success).toBe(true);
  });

  it("rejects unauthenticated requests on every catch-up endpoint", async () => {
    const app = buildApp();
    for (const path of [
      "/subscriptions",
      "/analytics/subscriptions",
      "/analytics/engagement",
      "/email-logs",
      "/audit-log",
    ]) {
      const res = await app.request(`/api/v1/admin${path}`);
      expect(res.status, path).toBe(401);
    }
  });
});

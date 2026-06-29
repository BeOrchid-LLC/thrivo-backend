import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import { buildApp } from "../../src/app";
import { signAdminSession, ADMIN_COOKIE } from "../../src/admin/session.service";
import { adminDashboardMetricsResponseSchema } from "../../contracts/src/admin-analytics";

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

describe.skipIf(!run)("integration: admin dashboard metrics", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeDb();
  });

  it("returns a snapshot matching the shared AdminDashboardMetrics contract", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/metrics/dashboard", {
      headers: { cookie: await adminCookie() },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { data: unknown };
    // The implemented endpoint must conform exactly to the promoted contract.
    const parsed = adminDashboardMetricsResponseSchema.safeParse(body.data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const { metrics } = parsed.data;
      // DAU/MAU come from last_active_at; with no active users they're zero, not faked.
      expect(metrics.dau).toBe(0);
      expect(metrics.mau).toBe(0);
      expect(Number.isFinite(metrics.activeSubscribers)).toBe(true);
    }
  });

  it("rejects an unauthenticated request", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/metrics/dashboard");
    expect(res.status).toBe(401);
  });
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import { buildApp } from "../../src/app";
import {
  adminOverviewMetricsResponseSchema,
  adminOverviewPlanBreakdownResponseSchema,
  adminOverviewRevenueTrendResponseSchema,
  adminOverviewTrialPipelineResponseSchema,
} from "../../contracts/src/admin-analytics";

const run = process.env.RUN_DB_TESTS === "1";

function adminBearer() {
  return "Bearer test-clerk-token:test_admin:admin@test.thrivo.fit";
}

describe.skipIf(!run)("integration: admin overview", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeDb();
  });

  it("GET /overview/metrics matches the shared contract with zeroed values on an empty DB", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/overview/metrics", {
      headers: { authorization: adminBearer() },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { data: unknown };
    const parsed = adminOverviewMetricsResponseSchema.safeParse(body.data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const { metrics } = parsed.data;
      expect(metrics.mrr).toEqual({ cents: 0, deltaPct: null });
      expect(metrics.premiumUsers).toEqual({ total: 0, monthly: 0, annual: 0 });
      expect(metrics.dauMau.totalUsers).toBe(0);
    }
  });

  it("GET /overview/revenue-trend matches the shared contract", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/overview/revenue-trend", {
      headers: { authorization: adminBearer() },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { data: unknown };
    const parsed = adminOverviewRevenueTrendResponseSchema.safeParse(body.data);
    expect(parsed.success).toBe(true);
  });

  it("GET /overview/trial-pipeline matches the shared contract with all-zero percentages when nothing started", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/overview/trial-pipeline", {
      headers: { authorization: adminBearer() },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { data: unknown };
    const parsed = adminOverviewTrialPipelineResponseSchema.safeParse(body.data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.trialPipeline).toEqual({
        started: 0,
        converted: 0,
        convertedPct: 0,
        cancelled: 0,
        cancelledPct: 0,
        activePct: 0,
      });
    }
  });

  it("GET /overview/plan-breakdown matches the shared contract", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/overview/plan-breakdown", {
      headers: { authorization: adminBearer() },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { data: unknown };
    const parsed = adminOverviewPlanBreakdownResponseSchema.safeParse(body.data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.planBreakdown.totalPremium).toBe(0);
      expect(parsed.data.planBreakdown.plans.map((p) => p.plan)).toEqual(["monthly", "annual"]);
    }
  });

  it("rejects unauthenticated requests on every overview route", async () => {
    const app = buildApp();
    const paths = [
      "/api/v1/admin/overview/metrics",
      "/api/v1/admin/overview/revenue-trend",
      "/api/v1/admin/overview/trial-pipeline",
      "/api/v1/admin/overview/plan-breakdown",
    ];
    for (const path of paths) {
      const res = await app.request(path);
      expect(res.status).toBe(401);
    }
  });
});

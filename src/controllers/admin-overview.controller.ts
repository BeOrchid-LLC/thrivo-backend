import type { Context } from "hono";
import { respondOk } from "../lib/response";
import {
  getOverviewMetrics,
  getOverviewPlanBreakdown,
  getOverviewRevenueTrend,
  getOverviewTrialPipeline,
} from "../services/admin-overview.service";
import type { AppEnv } from "../types/http";

/** GET /admin/overview/metrics */
export async function getAdminOverviewMetrics(c: Context<AppEnv>) {
  const metrics = await getOverviewMetrics();
  return respondOk(c, { metrics: { ...metrics, reportingCurrency: "USD" as const } });
}

/** GET /admin/overview/revenue-trend */
export async function getAdminOverviewRevenueTrend(c: Context<AppEnv>) {
  const revenueTrend = await getOverviewRevenueTrend();
  return respondOk(c, { revenueTrend });
}

/** GET /admin/overview/trial-pipeline */
export async function getAdminOverviewTrialPipeline(c: Context<AppEnv>) {
  const trialPipeline = await getOverviewTrialPipeline();
  return respondOk(c, { trialPipeline });
}

/** GET /admin/overview/plan-breakdown */
export async function getAdminOverviewPlanBreakdown(c: Context<AppEnv>) {
  const planBreakdown = await getOverviewPlanBreakdown();
  return respondOk(c, { planBreakdown });
}

import type { Context } from "hono";
import { respondOk } from "../lib/response";
import {
  getOverviewMetrics,
  getOverviewPlanBreakdown,
  getOverviewRevenueTrend,
  getOverviewTrialPipeline,
} from "../services/admin-overview.service";
import type { AppEnv } from "../types/http";
import { ValidationError } from "../lib/errors";
import { z } from "zod";

const isoDate = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));
const overviewRangeSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
});

function parseOverviewRange(input: unknown) {
  const range = overviewRangeSchema.parse(input);
  if (range.from && range.to && range.from > range.to) {
    throw new ValidationError("from must be before to");
  }
  return range;
}

/** GET /admin/overview/metrics */
export async function getAdminOverviewMetrics(c: Context<AppEnv>) {
  parseOverviewRange(c.req.query());
  const metrics = await getOverviewMetrics();
  return respondOk(c, { metrics: { ...metrics, reportingCurrency: "USD" as const } });
}

/** GET /admin/overview/revenue-trend */
export async function getAdminOverviewRevenueTrend(c: Context<AppEnv>) {
  const revenueTrend = await getOverviewRevenueTrend(parseOverviewRange(c.req.query()));
  return respondOk(c, { revenueTrend });
}

/** GET /admin/overview/trial-pipeline */
export async function getAdminOverviewTrialPipeline(c: Context<AppEnv>) {
  const trialPipeline = await getOverviewTrialPipeline(parseOverviewRange(c.req.query()));
  return respondOk(c, { trialPipeline });
}

/** GET /admin/overview/plan-breakdown */
export async function getAdminOverviewPlanBreakdown(c: Context<AppEnv>) {
  parseOverviewRange(c.req.query());
  const planBreakdown = await getOverviewPlanBreakdown();
  return respondOk(c, { planBreakdown });
}

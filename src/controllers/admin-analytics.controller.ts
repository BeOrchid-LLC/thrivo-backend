import type { Context } from "hono";
import { z } from "zod";
import { respondOk } from "../lib/response";
import {
  getEngagementAnalytics,
  getSubscriptionAnalytics,
} from "../services/admin-analytics.service";
import type { AppEnv } from "../types/http";
import { ValidationError } from "../lib/errors";

const isoDate = z
  .string()
  .datetime({ offset: true })
  .transform((v) => new Date(v));
const rangeQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  compareFrom: isoDate.optional(),
  compareTo: isoDate.optional(),
});

function parseRange(input: unknown) {
  const range = rangeQuerySchema.parse(input);
  if (range.from && range.to && range.from > range.to) {
    throw new ValidationError("from must be before to");
  }
  if (range.compareFrom && range.compareTo && range.compareFrom > range.compareTo) {
    throw new ValidationError("compareFrom must be before compareTo");
  }
  return range;
}

function csvField(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** GET /admin/analytics/subscriptions — subscription funnel + revenue analytics. */
export async function getAdminSubscriptionAnalytics(c: Context<AppEnv>) {
  const range = parseRange(c.req.query());
  const analytics = await getSubscriptionAnalytics(range);
  return respondOk(c, { analytics });
}

/** GET /admin/analytics/engagement — product-usage analytics. */
export async function getAdminEngagementAnalytics(c: Context<AppEnv>) {
  const range = parseRange(c.req.query());
  const analytics = await getEngagementAnalytics(range);
  return respondOk(c, { analytics });
}

export async function exportAdminSubscriptionAnalytics(c: Context<AppEnv>) {
  const analytics = await getSubscriptionAnalytics(parseRange(c.req.query()));
  const rows = [
    ["metric", "value"],
    ["mrr_cents", analytics.mrrCents],
    ["trial_starts", analytics.trialStarts],
    ["trial_conversions", analytics.trialConversions],
    ["cancellations", analytics.cancellations],
    ["free_count", analytics.freeCount],
    ["premium_count", analytics.premiumCount],
    ...analytics.mrrTrend.map((point) => [`mrr_${point.date}`, point.value]),
    ...analytics.churnTrend.map((point) => [`churned_mrr_${point.date}`, point.value]),
  ];
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", 'attachment; filename="subscription-analytics.csv"');
  return c.body(rows.map((row) => row.map(csvField).join(",")).join("\n"));
}

export async function exportAdminEngagementAnalytics(c: Context<AppEnv>) {
  const analytics = await getEngagementAnalytics(parseRange(c.req.query()));
  const rows = [
    ["dataset", "label", "value"],
    ...analytics.onboardingFunnel.map((row) => ["onboarding", row.step, row.count]),
    ...analytics.topFoods.map((row) => ["top_food", row.name, row.count]),
    ["streak", "average_days", analytics.averageStreakDays],
  ];
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", 'attachment; filename="engagement-analytics.csv"');
  return c.body(rows.map((row) => row.map(csvField).join(",")).join("\n"));
}

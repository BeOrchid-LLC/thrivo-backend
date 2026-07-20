import type { Context } from "hono";
import { z } from "zod";
import { respondOk } from "../lib/response";
import {
  getEngagementAnalytics,
  getSubscriptionAnalytics,
} from "../services/admin-analytics.service";
import type { AppEnv } from "../types/http";

const isoDate = z
  .string()
  .datetime({ offset: true })
  .transform((v) => new Date(v));
const rangeQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
});

/** GET /admin/analytics/subscriptions — subscription funnel + revenue analytics. */
export async function getAdminSubscriptionAnalytics(c: Context<AppEnv>) {
  const range = rangeQuerySchema.parse(c.req.query());
  const analytics = await getSubscriptionAnalytics(range);
  return respondOk(c, { analytics });
}

/** GET /admin/analytics/engagement — product-usage analytics. */
export async function getAdminEngagementAnalytics(c: Context<AppEnv>) {
  const range = rangeQuerySchema.parse(c.req.query());
  const analytics = await getEngagementAnalytics(range);
  return respondOk(c, { analytics });
}

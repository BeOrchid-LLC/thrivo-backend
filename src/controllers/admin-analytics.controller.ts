import type { Context } from "hono";
import { respondOk } from "../lib/response";
import {
  getEngagementAnalytics,
  getSubscriptionAnalytics,
} from "../services/admin-analytics.service";
import type { AppEnv } from "../types/http";

/** GET /admin/analytics/subscriptions — subscription funnel + revenue analytics. */
export async function getAdminSubscriptionAnalytics(c: Context<AppEnv>) {
  const analytics = await getSubscriptionAnalytics();
  return respondOk(c, { analytics });
}

/** GET /admin/analytics/engagement — product-usage analytics. */
export async function getAdminEngagementAnalytics(c: Context<AppEnv>) {
  const analytics = await getEngagementAnalytics();
  return respondOk(c, { analytics });
}

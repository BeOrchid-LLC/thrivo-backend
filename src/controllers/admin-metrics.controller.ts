import type { Context } from "hono";
import { respondOk } from "../lib/response";
import { getDashboardMetrics } from "../services/admin-metrics.service";
import type { AppEnv } from "../types/http";

/** GET /admin/metrics/dashboard — operational KPI snapshot for the admin home page. */
export async function getAdminDashboardMetrics(c: Context<AppEnv>) {
  const metrics = await getDashboardMetrics();
  return respondOk(c, { metrics });
}

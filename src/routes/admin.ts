import { Hono } from "hono";
import { requireAdmin } from "../middleware/require-admin";
import { adminOriginGuard } from "../middleware/admin-origin";
import { adminAuthRateLimit } from "../middleware/rate-limit";
import {
  postAdminRequestOtp,
  postAdminVerifyOtp,
  getAdminSession,
  postAdminLogout,
} from "../controllers/admin-auth.controller";
import {
  listAdminUsers,
  getAdminUser,
  getAdminUserTimeline,
  getAdminUserActivity,
  hardDeleteAdminUser,
} from "../controllers/admin-users.controller";
import { getAdminDashboardMetrics } from "../controllers/admin-metrics.controller";
import {
  getAdminOverviewMetrics,
  getAdminOverviewPlanBreakdown,
  getAdminOverviewRevenueTrend,
  getAdminOverviewTrialPipeline,
} from "../controllers/admin-overview.controller";
import {
  listAdminLeads,
  hardDeleteAdminLead,
  exportAdminLeads,
} from "../controllers/admin-leads.controller";
import type { AppEnv } from "../types/http";

/** `/api/v1/admin` — staff-only surface gated by the admin session cookie. */
export const adminRouter = new Hono<AppEnv>();

// CSRF defense-in-depth: reject cross-origin state-changing requests. No-ops
// for GETs. See admin-origin.ts for the full cookie/Origin threat model.
adminRouter.use("*", adminOriginGuard);

// Publicly reachable and previously unthrottled at the IP layer — the general
// apiRateLimit (120/min/IP) applies to all of /api/v1 already, but auth needs
// its own tighter bucket (matches the user /auth/* pattern in app.ts). The
// per-email issue throttle in admin/otp.service.ts is the primary guard.
adminRouter.use("/auth/*", adminAuthRateLimit);

// Auth (public — no cookie required to log in)
adminRouter.post("/auth/request-otp", postAdminRequestOtp);
adminRouter.post("/auth/verify-otp", postAdminVerifyOtp);

// Auth (protected — requires a valid admin session cookie)
adminRouter.get("/auth/session", requireAdmin, getAdminSession);
adminRouter.post("/auth/logout", requireAdmin, postAdminLogout);

// User management (all protected)
adminRouter.get("/users", requireAdmin, listAdminUsers);
adminRouter.get("/users/:id", requireAdmin, getAdminUser);
adminRouter.get("/users/:id/timeline", requireAdmin, getAdminUserTimeline);
adminRouter.get("/users/:id/activity", requireAdmin, getAdminUserActivity);
adminRouter.delete("/users/:id", requireAdmin, hardDeleteAdminUser);

// Metrics
adminRouter.get("/metrics/dashboard", requireAdmin, getAdminDashboardMetrics);

// Overview page — one route per independently-fetched section.
adminRouter.get("/overview/metrics", requireAdmin, getAdminOverviewMetrics);
adminRouter.get("/overview/revenue-trend", requireAdmin, getAdminOverviewRevenueTrend);
adminRouter.get("/overview/trial-pipeline", requireAdmin, getAdminOverviewTrialPipeline);
adminRouter.get("/overview/plan-breakdown", requireAdmin, getAdminOverviewPlanBreakdown);

// Leads (email captures) -- export route registered before /:id-shaped routes
// so "export" is never matched as an :id param.
adminRouter.get("/leads/export", requireAdmin, exportAdminLeads);
adminRouter.get("/leads", requireAdmin, listAdminLeads);
adminRouter.delete("/leads/:id", requireAdmin, hardDeleteAdminLead);

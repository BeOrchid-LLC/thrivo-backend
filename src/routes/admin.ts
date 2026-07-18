import { Hono } from "hono";
import { requireAdmin, requireAdminRole } from "../middleware/require-admin";
import { adminOriginGuard } from "../middleware/admin-origin";
import { adminAuthRateLimit } from "../middleware/rate-limit";
import { validate } from "../middleware/validate";
import { adminCancelPayloadSchema, adminRefundPayloadSchema } from "../../contracts/src/admin";
import { adminUpsertTipPayloadSchema } from "../../contracts/src/admin-content";
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
import { listAdminSubscriptions } from "../controllers/admin-subscriptions.controller";
import {
  getAdminSubscriptionAnalytics,
  getAdminEngagementAnalytics,
} from "../controllers/admin-analytics.controller";
import {
  listAdminTips,
  createAdminTip,
  updateAdminTip,
  deleteAdminTip,
} from "../controllers/admin-content.controller";
import { listAdminEmailLogs, listAdminAuditLog } from "../controllers/admin-logs.controller";
import {
  cancelAdminUserSubscription,
  refundAdminUserSubscription,
} from "../controllers/admin-subscription-actions.controller";
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
// Destructive: hard delete is admin-only (support/read-only get 403).
adminRouter.delete("/users/:id", requireAdmin, requireAdminRole("admin"), hardDeleteAdminUser);

// Subscription actions on a specific user (operator overrides, audited).
// Money-adjacent → admin-only.
adminRouter.post(
  "/users/:id/subscription/cancel",
  requireAdmin,
  requireAdminRole("admin"),
  validate("json", adminCancelPayloadSchema),
  cancelAdminUserSubscription
);
adminRouter.post(
  "/users/:id/subscription/refund",
  requireAdmin,
  requireAdminRole("admin"),
  validate("json", adminRefundPayloadSchema),
  refundAdminUserSubscription
);

// Subscriptions list
adminRouter.get("/subscriptions", requireAdmin, listAdminSubscriptions);

// Metrics
adminRouter.get("/metrics/dashboard", requireAdmin, getAdminDashboardMetrics);

// Analytics page — subscription funnel + engagement, fetched independently.
adminRouter.get("/analytics/subscriptions", requireAdmin, getAdminSubscriptionAnalytics);
adminRouter.get("/analytics/engagement", requireAdmin, getAdminEngagementAnalytics);

// Content — psychology tip bank CRUD. Content management is a support task, so
// mutations require support+ (read-only can view but not edit). All audited.
adminRouter.get("/tips", requireAdmin, listAdminTips);
adminRouter.post(
  "/tips",
  requireAdmin,
  requireAdminRole("support"),
  validate("json", adminUpsertTipPayloadSchema),
  createAdminTip
);
adminRouter.patch(
  "/tips/:id",
  requireAdmin,
  requireAdminRole("support"),
  validate("json", adminUpsertTipPayloadSchema),
  updateAdminTip
);
adminRouter.delete("/tips/:id", requireAdmin, requireAdminRole("support"), deleteAdminTip);

// Observability logs (read-only)
adminRouter.get("/email-logs", requireAdmin, listAdminEmailLogs);
adminRouter.get("/audit-log", requireAdmin, listAdminAuditLog);

// Overview page — one route per independently-fetched section.
adminRouter.get("/overview/metrics", requireAdmin, getAdminOverviewMetrics);
adminRouter.get("/overview/revenue-trend", requireAdmin, getAdminOverviewRevenueTrend);
adminRouter.get("/overview/trial-pipeline", requireAdmin, getAdminOverviewTrialPipeline);
adminRouter.get("/overview/plan-breakdown", requireAdmin, getAdminOverviewPlanBreakdown);

// Leads (email captures) -- export route registered before /:id-shaped routes
// so "export" is never matched as an :id param.
adminRouter.get("/leads/export", requireAdmin, exportAdminLeads);
adminRouter.get("/leads", requireAdmin, listAdminLeads);
adminRouter.delete("/leads/:id", requireAdmin, requireAdminRole("admin"), hardDeleteAdminLead);

import { Hono } from "hono";
import { requireAdmin, requireAdminRole, requireSuperAdmin } from "../middleware/require-admin";
import { adminOriginGuard } from "../middleware/admin-origin";
import { adminAuthRateLimit } from "../middleware/rate-limit";
import { validate } from "../middleware/validate";
import {
  adminCancelPayloadSchema,
  adminRefundPayloadSchema,
  adminPasswordLoginPayloadSchema,
  adminAcceptInvitePayloadSchema,
  adminRequestPasswordResetPayloadSchema,
  adminResetPasswordPayloadSchema,
  adminChangePasswordPayloadSchema,
} from "../../contracts/src/admin";
import {
  adminInvitePayloadSchema,
  adminUpdatePayloadSchema,
} from "../../contracts/src/admin-management";
import { adminUpsertTipPayloadSchema } from "../../contracts/src/admin-content";
import {
  adminFoodEditPayloadSchema,
  adminFoodMergePayloadSchema,
  adminFoodRejectPayloadSchema,
} from "../../contracts/src/admin-foods";
import {
  adminAudienceEstimatePayloadSchema,
  adminCreateCampaignPayloadSchema,
} from "../../contracts/src/admin-push";
import {
  postAdminRequestOtp,
  postAdminVerifyOtp,
  postAdminLogin,
  postAdminAcceptInvite,
  postAdminRequestPasswordReset,
  postAdminResetPassword,
  postAdminChangePassword,
  getAdminSession,
  postAdminLogout,
} from "../controllers/admin-auth.controller";
import {
  listAdminAccounts,
  inviteAdminAccount,
  updateAdminAccount,
  resendAdminInvite,
  disableAdminAccount,
} from "../controllers/admin-management.controller";
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
  listAdminBillingEvents,
  getAdminUserBillingEvents,
  listAdminWebhooks,
  getAdminWebhook,
  reconcileAdminUserSubscription,
} from "../controllers/admin-billing.controller";
import {
  listAdminPushCampaigns,
  getAdminPushCampaign,
  estimateAdminPushAudience,
  createAdminPushCampaign,
  sendAdminPushCampaign,
} from "../controllers/admin-push.controller";
import {
  listAdminCheckinNotes,
  redactAdminCheckinNote,
  restoreAdminCheckinNote,
  listAdminUploads,
  removeAdminUpload,
  restoreAdminUpload,
} from "../controllers/admin-moderation.controller";
import {
  listAdminFoods,
  getAdminFood,
  approveAdminFood,
  rejectAdminFood,
  verifyAdminFood,
  editAdminFood,
  mergeAdminFood,
} from "../controllers/admin-foods.controller";
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
adminRouter.post("/auth/login", validate("json", adminPasswordLoginPayloadSchema), postAdminLogin);
adminRouter.post("/auth/request-otp", postAdminRequestOtp);
adminRouter.post("/auth/verify-otp", postAdminVerifyOtp);
adminRouter.post(
  "/auth/accept-invite",
  validate("json", adminAcceptInvitePayloadSchema),
  postAdminAcceptInvite
);
adminRouter.post(
  "/auth/request-password-reset",
  validate("json", adminRequestPasswordResetPayloadSchema),
  postAdminRequestPasswordReset
);
adminRouter.post(
  "/auth/reset-password",
  validate("json", adminResetPasswordPayloadSchema),
  postAdminResetPassword
);

// Auth (protected — requires a valid admin session cookie)
adminRouter.get("/auth/session", requireAdmin, getAdminSession);
adminRouter.post("/auth/logout", requireAdmin, postAdminLogout);
adminRouter.post(
  "/auth/change-password",
  requireAdmin,
  validate("json", adminChangePasswordPayloadSchema),
  postAdminChangePassword
);

// Admin management (super-admin only — manage other admin accounts)
adminRouter.get("/admins", requireAdmin, requireSuperAdmin, listAdminAccounts);
adminRouter.post(
  "/admins/invite",
  requireAdmin,
  requireSuperAdmin,
  validate("json", adminInvitePayloadSchema),
  inviteAdminAccount
);
adminRouter.patch(
  "/admins/:id",
  requireAdmin,
  requireSuperAdmin,
  validate("json", adminUpdatePayloadSchema),
  updateAdminAccount
);
adminRouter.post("/admins/:id/resend-invite", requireAdmin, requireSuperAdmin, resendAdminInvite);
adminRouter.delete("/admins/:id", requireAdmin, requireSuperAdmin, disableAdminAccount);

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
// Per-user billing event timeline (read) + reconcile trigger (admin-only).
adminRouter.get("/users/:id/billing-events", requireAdmin, getAdminUserBillingEvents);
adminRouter.post(
  "/users/:id/reconcile-subscription",
  requireAdmin,
  requireAdminRole("admin"),
  reconcileAdminUserSubscription
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

// Food catalog moderation. Reads open to any admin; approve/reject/verify/edit
// are support+; merge (irreversible dedup) is admin-only. All mutations audited.
adminRouter.get("/foods", requireAdmin, listAdminFoods);
adminRouter.get("/foods/:id", requireAdmin, getAdminFood);
adminRouter.post("/foods/:id/approve", requireAdmin, requireAdminRole("support"), approveAdminFood);
adminRouter.post(
  "/foods/:id/reject",
  requireAdmin,
  requireAdminRole("support"),
  validate("json", adminFoodRejectPayloadSchema),
  rejectAdminFood
);
adminRouter.post("/foods/:id/verify", requireAdmin, requireAdminRole("support"), verifyAdminFood);
adminRouter.patch(
  "/foods/:id",
  requireAdmin,
  requireAdminRole("support"),
  validate("json", adminFoodEditPayloadSchema),
  editAdminFood
);
adminRouter.post(
  "/foods/:id/merge",
  requireAdmin,
  requireAdminRole("admin"),
  validate("json", adminFoodMergePayloadSchema),
  mergeAdminFood
);

// Billing observability — subscription funnel events + webhook ledger. Reads
// open to any admin; raw webhook payload is admin-only (may carry PII). The
// "webhooks" literal is registered before ":id"-shaped routes to avoid capture.
adminRouter.get("/billing/events", requireAdmin, listAdminBillingEvents);
adminRouter.get("/webhooks", requireAdmin, listAdminWebhooks);
adminRouter.get("/webhooks/:id", requireAdmin, requireAdminRole("admin"), getAdminWebhook);

// Push campaigns/broadcast. Reads + audience estimate for any admin; create is
// support+; send (irreversible, outward-facing) is admin-only. "audience-estimate"
// and "campaigns" literals precede ":id" routes.
adminRouter.get("/push/campaigns", requireAdmin, listAdminPushCampaigns);
adminRouter.post(
  "/push/audience-estimate",
  requireAdmin,
  validate("json", adminAudienceEstimatePayloadSchema),
  estimateAdminPushAudience
);
adminRouter.post(
  "/push/campaigns",
  requireAdmin,
  requireAdminRole("support"),
  validate("json", adminCreateCampaignPayloadSchema),
  createAdminPushCampaign
);
adminRouter.get("/push/campaigns/:id", requireAdmin, getAdminPushCampaign);
adminRouter.post(
  "/push/campaigns/:id/send",
  requireAdmin,
  requireAdminRole("admin"),
  sendAdminPushCampaign
);

// UGC moderation — check-in notes + avatar uploads. Reads for any admin;
// redact/restore are support+; removing an image is admin-only (destructive).
adminRouter.get("/moderation/checkin-notes", requireAdmin, listAdminCheckinNotes);
adminRouter.post(
  "/checkins/:id/redact",
  requireAdmin,
  requireAdminRole("support"),
  redactAdminCheckinNote
);
adminRouter.post(
  "/checkins/:id/restore",
  requireAdmin,
  requireAdminRole("support"),
  restoreAdminCheckinNote
);
adminRouter.get("/moderation/uploads", requireAdmin, listAdminUploads);
adminRouter.post("/uploads/:id/remove", requireAdmin, requireAdminRole("admin"), removeAdminUpload);
adminRouter.post(
  "/uploads/:id/restore",
  requireAdmin,
  requireAdminRole("support"),
  restoreAdminUpload
);

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

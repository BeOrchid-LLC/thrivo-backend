import { Hono } from "hono";
import {
  requireAdmin,
  requireAdminPermission,
  requireAdminRole,
} from "../middleware/require-admin";
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
  adminRetryErasurePayloadSchema,
  adminWebhookReprocessPayloadSchema,
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
  revokeAdminInvite,
} from "../controllers/admin-management.controller";
import { getAdminSettings, patchAdminSettings } from "../controllers/admin-settings.controller";
import {
  listAdminUsers,
  getAdminUser,
  getAdminUserTimeline,
  getAdminUserActivity,
  hardDeleteAdminUser,
  listAdminAccountErasures,
  retryAdminAccountErasure,
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
  reprocessAdminWebhook,
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
adminRouter.get(
  "/admins",
  requireAdmin,
  requireAdminPermission("admins.manage"),
  listAdminAccounts
);
adminRouter.post(
  "/admins/invite",
  requireAdmin,
  requireAdminPermission("admins.manage"),
  validate("json", adminInvitePayloadSchema),
  inviteAdminAccount
);
adminRouter.patch(
  "/admins/:id",
  requireAdmin,
  requireAdminPermission("admins.manage"),
  validate("json", adminUpdatePayloadSchema),
  updateAdminAccount
);
adminRouter.post(
  "/admins/:id/resend-invite",
  requireAdmin,
  requireAdminPermission("admins.manage"),
  resendAdminInvite
);
adminRouter.post(
  "/admins/:id/revoke-invite",
  requireAdmin,
  requireAdminPermission("admins.manage"),
  revokeAdminInvite
);
adminRouter.delete(
  "/admins/:id",
  requireAdmin,
  requireAdminPermission("admins.manage"),
  disableAdminAccount
);

// Global settings can be managed by admins and super-admins, but not support
// or read-only staff. The permission middleware is the authoritative check.
adminRouter.get(
  "/settings",
  requireAdmin,
  requireAdminPermission("settings.manage"),
  getAdminSettings
);
adminRouter.patch(
  "/settings",
  requireAdmin,
  requireAdminPermission("settings.manage"),
  patchAdminSettings
);

// User management (all protected)
adminRouter.get("/users", requireAdmin, requireAdminPermission("users.read"), listAdminUsers);
adminRouter.get("/users/:id", requireAdmin, requireAdminPermission("users.read"), getAdminUser);
adminRouter.get(
  "/users/:id/timeline",
  requireAdmin,
  requireAdminPermission("users.read"),
  getAdminUserTimeline
);
adminRouter.get(
  "/users/:id/activity",
  requireAdmin,
  requireAdminPermission("users.read"),
  getAdminUserActivity
);
// Destructive: hard delete is admin-only (support/read-only get 403).
adminRouter.delete(
  "/users/:id",
  requireAdmin,
  requireAdminPermission("users.manage"),
  hardDeleteAdminUser
);
adminRouter.get(
  "/account-erasures",
  requireAdmin,
  requireAdminPermission("erasures.manage"),
  listAdminAccountErasures
);
adminRouter.post(
  "/account-erasures/:id/retry",
  requireAdmin,
  requireAdminPermission("erasures.manage"),
  validate("json", adminRetryErasurePayloadSchema),
  retryAdminAccountErasure
);

// Subscription actions on a specific user (operator overrides, audited).
// Money-adjacent → admin-only.
adminRouter.post(
  "/users/:id/subscription/cancel",
  requireAdmin,
  requireAdminPermission("subscriptions.manage"),
  validate("json", adminCancelPayloadSchema),
  cancelAdminUserSubscription
);
adminRouter.post(
  "/users/:id/subscription/refund",
  requireAdmin,
  requireAdminPermission("subscriptions.manage"),
  validate("json", adminRefundPayloadSchema),
  refundAdminUserSubscription
);
// Per-user billing event timeline (read) + reconcile trigger (admin-only).
adminRouter.get(
  "/users/:id/billing-events",
  requireAdmin,
  requireAdminPermission("billing.read"),
  getAdminUserBillingEvents
);
adminRouter.post(
  "/users/:id/reconcile-subscription",
  requireAdmin,
  requireAdminPermission("subscriptions.manage"),
  reconcileAdminUserSubscription
);

// Subscriptions list
adminRouter.get(
  "/subscriptions",
  requireAdmin,
  requireAdminPermission("subscriptions.read"),
  listAdminSubscriptions
);

// Metrics
adminRouter.get(
  "/metrics/dashboard",
  requireAdmin,
  requireAdminPermission("analytics.read"),
  getAdminDashboardMetrics
);

// Analytics page — subscription funnel + engagement, fetched independently.
adminRouter.get(
  "/analytics/subscriptions",
  requireAdmin,
  requireAdminPermission("analytics.read"),
  getAdminSubscriptionAnalytics
);
adminRouter.get(
  "/analytics/engagement",
  requireAdmin,
  requireAdminPermission("analytics.read"),
  getAdminEngagementAnalytics
);

// Content — psychology tip bank CRUD. Content management is a support task, so
// mutations require support+ (read-only can view but not edit). All audited.
adminRouter.get("/tips", requireAdmin, listAdminTips);
adminRouter.post(
  "/tips",
  requireAdmin,
  requireAdminPermission("content.manage"),
  validate("json", adminUpsertTipPayloadSchema),
  createAdminTip
);
adminRouter.patch(
  "/tips/:id",
  requireAdmin,
  requireAdminPermission("content.manage"),
  validate("json", adminUpsertTipPayloadSchema),
  updateAdminTip
);
adminRouter.delete(
  "/tips/:id",
  requireAdmin,
  requireAdminPermission("content.manage"),
  deleteAdminTip
);

// Food catalog moderation. Reads open to any admin; approve/reject/verify/edit
// are support+; merge (irreversible dedup) is admin-only. All mutations audited.
adminRouter.get("/foods", requireAdmin, listAdminFoods);
adminRouter.get("/foods/:id", requireAdmin, getAdminFood);
adminRouter.post(
  "/foods/:id/approve",
  requireAdmin,
  requireAdminPermission("foods.manage"),
  approveAdminFood
);
adminRouter.post(
  "/foods/:id/reject",
  requireAdmin,
  requireAdminPermission("foods.manage"),
  validate("json", adminFoodRejectPayloadSchema),
  rejectAdminFood
);
adminRouter.post(
  "/foods/:id/verify",
  requireAdmin,
  requireAdminPermission("foods.manage"),
  verifyAdminFood
);
adminRouter.patch(
  "/foods/:id",
  requireAdmin,
  requireAdminPermission("foods.manage"),
  validate("json", adminFoodEditPayloadSchema),
  editAdminFood
);
adminRouter.post(
  "/foods/:id/merge",
  requireAdmin,
  requireAdminPermission("foods.manage"),
  validate("json", adminFoodMergePayloadSchema),
  mergeAdminFood
);

// Billing observability — subscription funnel events + webhook ledger. Reads
// open to any admin; raw webhook payload is admin-only (may carry PII). The
// "webhooks" literal is registered before ":id"-shaped routes to avoid capture.
adminRouter.get(
  "/billing/events",
  requireAdmin,
  requireAdminPermission("billing.read"),
  listAdminBillingEvents
);
adminRouter.get(
  "/webhooks",
  requireAdmin,
  requireAdminPermission("billing.read"),
  listAdminWebhooks
);
adminRouter.get("/webhooks/:id", requireAdmin, requireAdminRole("admin"), getAdminWebhook);
adminRouter.post(
  "/webhooks/:id/reprocess",
  requireAdmin,
  requireAdminPermission("billing.manage"),
  validate("json", adminWebhookReprocessPayloadSchema),
  reprocessAdminWebhook
);

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
  requireAdminPermission("push.manage"),
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
  requireAdminPermission("moderation.manage"),
  redactAdminCheckinNote
);
adminRouter.post(
  "/checkins/:id/restore",
  requireAdmin,
  requireAdminPermission("moderation.manage"),
  restoreAdminCheckinNote
);
adminRouter.get("/moderation/uploads", requireAdmin, listAdminUploads);
adminRouter.post(
  "/uploads/:id/remove",
  requireAdmin,
  requireAdminPermission("moderation.manage"),
  removeAdminUpload
);
adminRouter.post(
  "/uploads/:id/restore",
  requireAdmin,
  requireAdminPermission("moderation.manage"),
  restoreAdminUpload
);

// Observability logs (read-only)
adminRouter.get(
  "/email-logs",
  requireAdmin,
  requireAdminPermission("audit.read"),
  listAdminEmailLogs
);
adminRouter.get(
  "/audit-log",
  requireAdmin,
  requireAdminPermission("audit.read"),
  listAdminAuditLog
);

// Overview page — one route per independently-fetched section.
adminRouter.get(
  "/overview/metrics",
  requireAdmin,
  requireAdminPermission("analytics.read"),
  getAdminOverviewMetrics
);
adminRouter.get(
  "/overview/revenue-trend",
  requireAdmin,
  requireAdminPermission("analytics.read"),
  getAdminOverviewRevenueTrend
);
adminRouter.get(
  "/overview/trial-pipeline",
  requireAdmin,
  requireAdminPermission("analytics.read"),
  getAdminOverviewTrialPipeline
);
adminRouter.get(
  "/overview/plan-breakdown",
  requireAdmin,
  requireAdminPermission("analytics.read"),
  getAdminOverviewPlanBreakdown
);

// Leads (email captures) -- export route registered before /:id-shaped routes
// so "export" is never matched as an :id param.
adminRouter.get(
  "/leads/export",
  requireAdmin,
  requireAdminPermission("leads.manage"),
  exportAdminLeads
);
adminRouter.get("/leads", requireAdmin, requireAdminPermission("leads.manage"), listAdminLeads);
adminRouter.delete(
  "/leads/:id",
  requireAdmin,
  requireAdminPermission("leads.manage"),
  hardDeleteAdminLead
);

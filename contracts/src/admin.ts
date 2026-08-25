import { z } from "zod";
import type { RouteContract } from "./common";
import { userProfileSchema } from "./users";
import { idSchema, isoDateSchema } from "./common";

// ---------------------------------------------------------------------------
// Admin identity
// ---------------------------------------------------------------------------

export const adminRoleSchema = z.enum(["super-admin", "admin", "support", "read-only"]);
export type AdminRole = z.infer<typeof adminRoleSchema>;

export const adminSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string().nullable(),
  role: adminRoleSchema,
});
export type Admin = z.infer<typeof adminSchema>;

// ---------------------------------------------------------------------------
// Admin auth payloads + responses
// ---------------------------------------------------------------------------

export const adminSessionResponseSchema = z.object({ admin: adminSchema });
export type AdminSessionResponse = z.infer<typeof adminSessionResponseSchema>;

export const adminAckSchema = z.null();
export type AdminAck = null;

export const adminOtpRequestPayloadSchema = z.object({
  email: z.string().email(),
});
export type AdminOtpRequestPayload = z.infer<typeof adminOtpRequestPayloadSchema>;

export const adminOtpVerifyPayloadSchema = z.object({
  email: z.string().email(),
  code: z.string().min(4),
});
export type AdminOtpVerifyPayload = z.infer<typeof adminOtpVerifyPayloadSchema>;

/**
 * Password policy shared by every admin credential payload (login is min(1) so
 * we don't leak the rule on the sign-in form; setting/changing a password
 * enforces the real minimum). Kept as one constant so the seed, the API, and
 * the frontend forms can't drift.
 */
export const ADMIN_PASSWORD_MIN = 10;
export const adminPasswordSchema = z.string().min(ADMIN_PASSWORD_MIN);

/** Password login (primary). OTP request/verify above remain as the fallback. */
export const adminPasswordLoginPayloadSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type AdminPasswordLoginPayload = z.infer<typeof adminPasswordLoginPayloadSchema>;

/** Accept an invite — sets the first password and activates the account. */
export const adminAcceptInvitePayloadSchema = z.object({
  email: z.string().email(),
  token: z.string().min(1),
  password: adminPasswordSchema,
});
export type AdminAcceptInvitePayload = z.infer<typeof adminAcceptInvitePayloadSchema>;

/** Forgot-password step 1 — request a reset link. Always 200 (anti-enumeration). */
export const adminRequestPasswordResetPayloadSchema = z.object({
  email: z.string().email(),
});
export type AdminRequestPasswordResetPayload = z.infer<
  typeof adminRequestPasswordResetPayloadSchema
>;

/** Forgot-password step 2 — set a new password with the emailed token. */
export const adminResetPasswordPayloadSchema = z.object({
  email: z.string().email(),
  token: z.string().min(1),
  password: adminPasswordSchema,
});
export type AdminResetPasswordPayload = z.infer<typeof adminResetPasswordPayloadSchema>;

/** Authenticated password change from account settings. */
export const adminChangePasswordPayloadSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: adminPasswordSchema,
});
export type AdminChangePasswordPayload = z.infer<typeof adminChangePasswordPayloadSchema>;

// ---------------------------------------------------------------------------
// Admin pagination helpers
// ---------------------------------------------------------------------------

/**
 * Offset pagination — still the shape for every admin list endpoint that
 * hasn't been converted off OFFSET yet (subscriptions, tips, email-logs,
 * audit-log; none of those routes exist server-side as of R5-4, but the
 * contract is defined ahead of the implementation). Do NOT reuse this for a
 * new list endpoint — SYSTEM_DESIGN §373 mandates keyset for any unbounded
 * list; use `adminKeysetPaginationSchema` instead.
 */
export const adminPaginationSchema = z.object({
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  totalPages: z.number(),
});
export type AdminPagination = z.infer<typeof adminPaginationSchema>;

export const adminPaginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), pagination: adminPaginationSchema });

/**
 * Keyset pagination (R5-4/I16) — no `page`/`totalPages`, since a numeric page
 * offset is exactly the "scan-and-discard, drifts under concurrent inserts"
 * failure mode this replaces (SYSTEM_DESIGN §373). `nextCursor` is opaque;
 * pass it back as `cursor` to fetch the next page, null on the last page.
 * Used by `admin/users` and `admin/leads`, the two endpoints R5-4 actually
 * converted — every other admin list endpoint still uses
 * `adminPaginationSchema` above until it gets the same treatment.
 */
export const adminKeysetPaginationSchema = z.object({
  limit: z.number(),
  total: z.number(),
  nextCursor: z.string().nullable(),
});
export type AdminKeysetPagination = z.infer<typeof adminKeysetPaginationSchema>;

export const adminKeysetPaginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), pagination: adminKeysetPaginationSchema });

// ---------------------------------------------------------------------------
// Admin user schemas
// ---------------------------------------------------------------------------

export const adminEntitlementSchema = z.enum(["free", "premium"]);
export type AdminEntitlement = z.infer<typeof adminEntitlementSchema>;

export const adminUserStatusSchema = z.enum(["active", "suspended", "deleted"]);
export type AdminUserStatus = z.infer<typeof adminUserStatusSchema>;

export const adminSubscriptionStatusSchema = z.enum([
  "active",
  "trialing",
  "canceled",
  "expired",
  "none",
]);
export type AdminSubscriptionStatus = z.infer<typeof adminSubscriptionStatusSchema>;

export const adminDeleteUserPayloadSchema = z.object({ confirmationEmail: z.string().email() });
export type AdminDeleteUserPayload = z.infer<typeof adminDeleteUserPayloadSchema>;

export const adminErasureStatusSchema = z.enum([
  "pending",
  "processing",
  "retryable",
  "failed",
  "completed",
]);
export const adminAccountErasureSchema = z.object({
  id: idSchema,
  status: adminErasureStatusSchema,
  requestedAt: isoDateSchema,
  completedAt: isoDateSchema.nullable(),
  lastErrorCode: z.string().nullable(),
  attempts: z.number().int(),
  consecutiveFailures: z.number().int(),
  nextAttemptAt: isoDateSchema,
  processingStartedAt: isoDateSchema.nullable(),
  leaseExpiresAt: isoDateSchema.nullable(),
  phase: z.enum([
    "external_deletion",
    "upload_wait",
    "r2_deletion",
    "redaction",
    "domain_deletion",
    "finalization",
  ]),
  canRetry: z.boolean(),
});
export const adminAccountErasureListResponseSchema = z.object({
  erasures: z.array(adminAccountErasureSchema),
  pagination: adminPaginationSchema,
});
export const adminRetryErasurePayloadSchema = z.object({ confirmation: z.literal("RETRY") });

export const moneySchema = z.object({
  amountCents: z.number().int(),
  /** ISO-4217 currency, or null when the provider did not supply one. */
  currency: z.string().length(3).nullable(),
});
export type Money = z.infer<typeof moneySchema>;

export const adminUserSubscriptionSchema = z.object({
  status: adminSubscriptionStatusSchema,
  priceLabel: z.string().nullable(),
  renewsAt: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  // Derived from subscription_events, not new `subscriptions` columns — that
  // table is current-state-only and can't answer "when did this happen".
  trialStartedAt: z.string().nullable(),
  trialConvertedAt: z.string().nullable(),
  firstChargeAt: z.string().nullable(),
  /** @deprecated Use firstCharge.amountCents and firstCharge.currency. */
  firstChargeAmountCents: z.number().int().nullable(),
  /** Sum of subscription_events.priceAmountCents. Null (not 0) means "no
   *  priced events yet", not "$0 of revenue". */
  /** @deprecated Only populated for a single known currency. */
  revenueToDateCents: z.number().int().nullable(),
  /** Deprecated currency-ambiguous totals retained for old clients. */
  firstCharge: moneySchema.nullable().default(null),
  revenueTotalsByCurrency: z.array(moneySchema).default([]),
  lastSyncedAt: z.string().nullable().default(null),
  lastWebhookAt: z.string().nullable().default(null),
  /** Always null today — no Stripe webhook path exists in this codebase,
   *  only RevenueCat. Present so the frontend has a stable field to render "—". */
  stripeCustomerId: z.string().nullable(),
  rcAppUserId: z.string().nullable(),
});
export type AdminUserSubscription = z.infer<typeof adminUserSubscriptionSchema>;

export const adminWebhookReprocessPayloadSchema = z.object({
  confirmation: z.literal("REPROCESS"),
});

/** Receiving-end only as of this contract version — populated once a future
 *  mobile-app task reports it; null for every user until then. */
export const adminUserDeviceSchema = z.object({
  platform: z.enum(["ios", "android"]).nullable(),
  osVersion: z.string().nullable(),
  deviceModel: z.string().nullable(),
});
export type AdminUserDevice = z.infer<typeof adminUserDeviceSchema>;

export const adminUserStatsSchema = z.object({
  currentStreakDays: z.number().int(),
  totalFoodLogs: z.number().int(),
  totalWeightLogs: z.number().int(),
  totalCheckIns: z.number().int(),
  /** Null (not 0) when there's no daily_summaries data in the averaging window. */
  avgDailyKcal: z.number().int().nullable(),
});
export type AdminUserStats = z.infer<typeof adminUserStatsSchema>;

/** Full user record for admin list + detail — every users column except authSubjectId. */
export const adminUserDetailSchema = userProfileSchema
  .extend({
    name: z.string().nullable(),
    onboardingSkipped: z.boolean(),
    subscriptionStatus: z.string().nullable(),
    deletedAt: z.coerce.date().nullable(),
    updatedAt: z.coerce.date(),
    status: adminUserStatusSchema,
    lastActiveAt: z.string().nullable(),
    // Kept at the top level for backward compat with existing readers (e.g.
    // the users list table); also nested under `stats` alongside the 2 new
    // counts for the user-detail page's stat-cards row.
    totalFoodLogs: z.number().int(),
    currentStreakDays: z.number().int(),
    subscription: adminUserSubscriptionSchema.nullable(),
    device: adminUserDeviceSchema.nullable(),
    /** The upgrade-prompt trigger that led to conversion (e.g. "3-day streak"),
     *  from the most recent `user_events` upgrade_prompt_shown row. Null until
     *  that event type is ever fired (future mobile-app instrumentation). */
    convertedViaTrigger: z.string().nullable(),
    stats: adminUserStatsSchema,
  })
  .omit({ createdAt: true })
  .extend({
    createdAt: z.coerce.date(),
  });

export type AdminUserDetail = z.infer<typeof adminUserDetailSchema>;

/** List rows use the same full shape as detail. */
export const adminUserSchema = adminUserDetailSchema;
export type AdminUser = AdminUserDetail;

export const adminUserDetailResponseSchema = z.object({ user: adminUserDetailSchema });
export type AdminUserDetailResponse = z.infer<typeof adminUserDetailResponseSchema>;

/** GET /admin/users — keyset-paginated (R5-4/I16); see `adminKeysetPaginated` above. */
export const adminUserListResponseSchema = adminKeysetPaginated(adminUserSchema);
export type AdminUserListResponse = z.infer<typeof adminUserListResponseSchema>;

export const adminCancelPayloadSchema = z.object({ reason: z.string().min(1) });
export type AdminCancelPayload = z.infer<typeof adminCancelPayloadSchema>;

export const adminRefundPayloadSchema = z.object({
  amountCents: z.number().int().positive().optional(),
  reason: z.string().min(1),
});
export type AdminRefundPayload = z.infer<typeof adminRefundPayloadSchema>;

/** Response for CSV/export endpoints — a signed download URL. */
export const adminExportResponseSchema = z.object({ url: z.string().url() });
export type AdminExportResponse = z.infer<typeof adminExportResponseSchema>;

// ---------------------------------------------------------------------------
// Admin user-detail timeline
// ---------------------------------------------------------------------------

export const adminTimelineEntryTypeSchema = z.enum([
  "account_created",
  "onboarding_completed",
  "upgrade_prompt_shown",
  "trial_started",
  "trial_converted",
  "trial_cancelled",
  "renewed",
  "expired",
  "canceled",
  "billing_issue",
  "refunded",
  "refund_reversed",
  "product_changed",
  "subscription_extended",
  "next_charge_scheduled",
]);
export type AdminTimelineEntryType = z.infer<typeof adminTimelineEntryTypeSchema>;

export const adminTimelineEntrySchema = z.object({
  type: adminTimelineEntryTypeSchema,
  title: z.string(),
  subtitle: z.string().nullable(),
  occurredAt: z.string(),
  /** "scheduled" only for the synthesized next_charge_scheduled entry — a
   *  future point, never a stored row. Everything else is "completed". */
  status: z.enum(["completed", "scheduled"]),
});
export type AdminTimelineEntry = z.infer<typeof adminTimelineEntrySchema>;

export const adminUserTimelineResponseSchema = z.object({
  timeline: z.array(adminTimelineEntrySchema),
});
export type AdminUserTimelineResponse = z.infer<typeof adminUserTimelineResponseSchema>;

// ---------------------------------------------------------------------------
// Admin user-detail activity tabs
// ---------------------------------------------------------------------------

export const adminActivityTypeSchema = z.enum(["food_logs", "check_ins", "weight_logs"]);
export type AdminActivityType = z.infer<typeof adminActivityTypeSchema>;

/** No `meal` field — food_logs has no meal column in the schema. */
export const adminActivityFoodLogItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  localDate: z.string(),
  servingQty: z.number().nullable(),
  servingUnit: z.string().nullable(),
  kcal: z.number().int(),
});
export type AdminActivityFoodLogItem = z.infer<typeof adminActivityFoodLogItemSchema>;

export const adminActivityCheckInItemSchema = z.object({
  id: z.string(),
  localDate: z.string(),
  mood: z.string(),
  note: z.string().nullable(),
});
export type AdminActivityCheckInItem = z.infer<typeof adminActivityCheckInItemSchema>;

export const adminActivityWeightLogItemSchema = z.object({
  id: z.string(),
  localDate: z.string(),
  weightKg: z.number(),
  note: z.string().nullable(),
});
export type AdminActivityWeightLogItem = z.infer<typeof adminActivityWeightLogItemSchema>;

export const adminActivityItemSchema = z.union([
  adminActivityFoodLogItemSchema,
  adminActivityCheckInItemSchema,
  adminActivityWeightLogItemSchema,
]);
export type AdminActivityItem = z.infer<typeof adminActivityItemSchema>;

/** One call = one type's items, so a plain array is enough — the client
 *  already knows which type it asked for via the `type` query param. */
export const adminUserActivityResponseSchema = z.object({
  items: z.array(adminActivityItemSchema),
  total: z.number().int(),
  limit: z.number().int(),
});
export type AdminUserActivityResponse = z.infer<typeof adminUserActivityResponseSchema>;

// ---------------------------------------------------------------------------
// Admin route contracts
// ---------------------------------------------------------------------------

export const adminRoutes = {
  // Auth (staff OTP login — session stored in httpOnly cookie)
  getSession: {
    method: "GET",
    path: "/api/v1/admin/auth/session",
    auth: "admin",
  },
  requestOtp: {
    method: "POST",
    path: "/api/v1/admin/auth/request-otp",
    auth: "public",
  },
  verifyOtp: {
    method: "POST",
    path: "/api/v1/admin/auth/verify-otp",
    auth: "public",
  },
  adminLogout: {
    method: "POST",
    path: "/api/v1/admin/auth/logout",
    auth: "admin",
  },

  // User management
  listUsers: {
    method: "GET",
    path: "/api/v1/admin/users",
    auth: "admin",
  },
  getUser: {
    method: "GET",
    path: "/api/v1/admin/users/:id",
    auth: "admin",
  },
  hardDeleteUser: {
    method: "DELETE",
    path: "/api/v1/admin/users/:id",
    auth: "admin",
  },
  getUserTimeline: {
    method: "GET",
    path: "/api/v1/admin/users/:id/timeline",
    auth: "admin",
  },
  getUserActivity: {
    method: "GET",
    path: "/api/v1/admin/users/:id/activity",
    auth: "admin",
  },
  getDashboardMetrics: {
    method: "GET",
    path: "/api/v1/admin/metrics/dashboard",
    auth: "admin",
  },

  // Overview page — one route per independently-fetched section.
  getOverviewMetrics: {
    method: "GET",
    path: "/api/v1/admin/overview/metrics",
    auth: "admin",
  },
  getOverviewRevenueTrend: {
    method: "GET",
    path: "/api/v1/admin/overview/revenue-trend",
    auth: "admin",
  },
  getOverviewTrialPipeline: {
    method: "GET",
    path: "/api/v1/admin/overview/trial-pipeline",
    auth: "admin",
  },
  getOverviewPlanBreakdown: {
    method: "GET",
    path: "/api/v1/admin/overview/plan-breakdown",
    auth: "admin",
  },
  cancelSubscription: {
    method: "POST",
    path: "/api/v1/admin/users/:id/subscription/cancel",
    auth: "admin",
  },
  refundSubscription: {
    method: "POST",
    path: "/api/v1/admin/users/:id/subscription/refund",
    auth: "admin",
  },
} satisfies Record<string, RouteContract>;

import { z } from "zod";
import type { RouteContract } from "./common";
import { userProfileSchema } from "./users";

// ---------------------------------------------------------------------------
// Admin identity
// ---------------------------------------------------------------------------

export const adminRoleSchema = z.enum(["admin", "support", "read-only"]);
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

export const adminUserSubscriptionSchema = z.object({
  status: adminSubscriptionStatusSchema,
  priceLabel: z.string().nullable(),
  renewsAt: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
});
export type AdminUserSubscription = z.infer<typeof adminUserSubscriptionSchema>;

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
    totalFoodLogs: z.number().int(),
    currentStreakDays: z.number().int(),
    subscription: adminUserSubscriptionSchema.nullable(),
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
  getDashboardMetrics: {
    method: "GET",
    path: "/api/v1/admin/metrics/dashboard",
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

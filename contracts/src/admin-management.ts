import { z } from "zod";
import { idSchema, isoDateSchema, type RouteContract } from "./common";
import { adminRoleSchema } from "./admin";

/**
 * Admin-management DTOs (super-admin only). Admin identity now lives in the
 * `admin_users` table rather than env vars, so these describe the CRUD surface
 * a super-admin uses to invite and manage other admins.
 */

/**
 * Account lifecycle:
 *  - `invited`  — row exists, no password yet; a Redis invite token is live.
 *  - `active`   — has accepted the invite (or was seeded) and can log in.
 *  - `disabled` — soft-disabled; login refused and existing sessions revoked
 *                 (snapshot cache invalidated) on the next request.
 */
export const adminAccountStatusSchema = z.enum(["invited", "active", "disabled", "revoked"]);
export type AdminAccountStatus = z.infer<typeof adminAccountStatusSchema>;

export const adminPermissionSchema = z.enum([
  "users.read",
  "users.manage",
  "subscriptions.read",
  "subscriptions.manage",
  "billing.read",
  "billing.manage",
  "content.manage",
  "moderation.manage",
  "foods.manage",
  "push.manage",
  "erasures.manage",
  "leads.manage",
  "audit.read",
  "analytics.read",
  "admins.manage",
  "settings.manage",
]);
export type AdminPermission = z.infer<typeof adminPermissionSchema>;

/** Null means the account uses the permissions implied by its role. */
export const adminPermissionsSchema = z.array(adminPermissionSchema).nullable();
export type AdminPermissions = z.infer<typeof adminPermissionsSchema>;

/** One admin account as shown in the management list / detail. */
export const adminAccountSchema = z.object({
  id: idSchema,
  email: z.string().email(),
  name: z.string().nullable(),
  role: adminRoleSchema,
  status: adminAccountStatusSchema,
  permissions: adminPermissionsSchema,
  invitedByEmail: z.string().email().nullable(),
  lastLoginAt: isoDateSchema.nullable(),
  inviteExpiresAt: isoDateSchema.nullable(),
  inviteRevokedAt: isoDateSchema.nullable(),
  createdAt: isoDateSchema,
});
export type AdminAccount = z.infer<typeof adminAccountSchema>;

export const adminAccountResponseSchema = z.object({ admin: adminAccountSchema });
export type AdminAccountResponse = z.infer<typeof adminAccountResponseSchema>;

export const adminAccountListResponseSchema = z.object({
  items: z.array(adminAccountSchema),
});
export type AdminAccountListResponse = z.infer<typeof adminAccountListResponseSchema>;

/** Invite a new admin. Role is required; a super-admin picks the tier. */
export const adminInvitePayloadSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  role: adminRoleSchema,
});
export type AdminInvitePayload = z.infer<typeof adminInvitePayloadSchema>;

/** Update an existing admin — any subset of identity, role, permissions, or status. */
export const adminUpdatePayloadSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    role: adminRoleSchema.optional(),
    status: adminAccountStatusSchema.optional(),
    permissions: adminPermissionsSchema.optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.role !== undefined ||
      v.status !== undefined ||
      v.permissions !== undefined,
    {
      message: "At least one field must be provided",
    }
  );
export type AdminUpdatePayload = z.infer<typeof adminUpdatePayloadSchema>;

export const adminRevokeInviteResponseSchema = z.object({ admin: adminAccountSchema });

export const adminSettingsRoutes = {
  get: { method: "GET", path: "/api/v1/admin/settings", auth: "admin" },
  update: { method: "PATCH", path: "/api/v1/admin/settings", auth: "admin" },
} satisfies Record<string, RouteContract>;

export const adminSettingsResponseSchema = z.object({
  settings: z.object({
    key: z.literal("default"),
    pushNotificationsEnabled: z.boolean(),
    dailyFoodLogReminderEnabled: z.boolean(),
    psychologyTipPushEnabled: z.boolean(),
    emailFoodLogReminderEnabled: z.boolean(),
    weeklyReviewEmailEnabled: z.boolean(),
    weightCheckReminderEnabled: z.boolean(),
    hydrationReminderEnabled: z.boolean(),
    subscriptionsEnabled: z.boolean(),
    trialsEnabled: z.boolean(),
    purchasesEnabled: z.boolean(),
    cancellationsEnabled: z.boolean(),
    trialDays: z.number().int().min(1).max(90),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
  }),
});

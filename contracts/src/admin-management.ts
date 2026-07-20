import { z } from "zod";
import { idSchema, isoDateSchema } from "./common";
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
export const adminAccountStatusSchema = z.enum(["invited", "active", "disabled"]);
export type AdminAccountStatus = z.infer<typeof adminAccountStatusSchema>;

/**
 * Reserved for future finer-grained permissions. NOT enforced anywhere yet —
 * authorization is still the `adminRoleSchema` rank ladder. Present so the
 * `admin_users.permissions` jsonb column has a typed shape to grow into.
 */
export const adminPermissionsSchema = z.array(z.string()).nullable();
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

/** Update an existing admin — any subset of name/role/status. */
export const adminUpdatePayloadSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    role: adminRoleSchema.optional(),
    status: adminAccountStatusSchema.optional(),
  })
  .refine((v) => v.name !== undefined || v.role !== undefined || v.status !== undefined, {
    message: "At least one field must be provided",
  });
export type AdminUpdatePayload = z.infer<typeof adminUpdatePayloadSchema>;

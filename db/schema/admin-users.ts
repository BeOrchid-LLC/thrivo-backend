import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { citext, idPk, timestamps } from "./_shared";

/**
 * Admin staff accounts. Admin identity used to live purely in env vars
 * (ADMIN_EMAILS / ADMIN_ROLES); it now lives here so a password, invite state,
 * and per-admin management have somewhere to persist. The env allowlist is kept
 * only as an optional seed bootstrap (see db/seed-admins.ts), never on the
 * request path.
 *
 * `password_hash` is nullable: an `invited` row has no password until the invite
 * is accepted, and an OTP-only admin may never set one. `permissions` is null
 * when the account uses its role defaults and otherwise contains its explicit
 * effective permission set.
 */
export const adminUsers = pgTable("admin_users", {
  id: idPk(),
  // citext → case-insensitive uniqueness at the DB level (emails are lowercased
  // in the repo too, but this is the load-bearing guard against dupes).
  email: citext("email").notNull().unique(),
  name: text("name"),
  // super-admin | admin | support | read-only (see contracts adminRoleSchema).
  role: text("role").notNull(),
  passwordHash: text("password_hash"),
  // invited | active | disabled | revoked (see contracts adminAccountStatusSchema).
  status: text("status").notNull().default("invited"),
  permissions: jsonb("permissions").$type<string[] | null>(),
  // Clerk Admin app user ID (user_xxx from the BeOrchid Admin Clerk application).
  // Populated via the /webhooks/clerk-admin endpoint on first sign-in; null for
  // admin rows that pre-date Clerk Admin or were created before the webhook fired.
  clerkAdminId: text("clerk_admin_id").unique(),
  clerkInvitationId: text("clerk_invitation_id").unique(),
  invitedByEmail: text("invited_by_email"),
  inviteExpiresAt: timestamp("invite_expires_at", { withTimezone: true }),
  inviteRevokedAt: timestamp("invite_revoked_at", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  ...timestamps,
});

export type AdminUserRow = typeof adminUsers.$inferSelect;
export type NewAdminUserRow = typeof adminUsers.$inferInsert;

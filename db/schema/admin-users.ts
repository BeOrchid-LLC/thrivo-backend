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
 * is accepted, and an OTP-only admin may never set one. `permissions` is the
 * reserved foundation for future finer-grained access control — it is NOT
 * enforced yet; authorization is still the role rank ladder.
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
  // invited | active | disabled (see contracts adminAccountStatusSchema).
  status: text("status").notNull().default("invited"),
  permissions: jsonb("permissions").$type<string[] | null>(),
  invitedByEmail: text("invited_by_email"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  ...timestamps,
});

export type AdminUserRow = typeof adminUsers.$inferSelect;
export type NewAdminUserRow = typeof adminUsers.$inferInsert;

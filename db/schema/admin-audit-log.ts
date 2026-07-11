import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { idPk } from "./_shared";

/** Append-only record of every admin mutation (who, what, when, before/after). */
export const adminAuditLog = pgTable("admin_audit_log", {
  id: idPk(),
  // Admin identity is the ADMIN_EMAILS allowlist entry, not a row in a table —
  // there is no admin-users PK to reference, so the actor is the email itself
  // (previously typed `uuid`, which would have thrown on every insert).
  actorAdminEmail: text("actor_admin_email").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  before: jsonb("before"),
  after: jsonb("after"),
  requestId: text("request_id"),
  ip: text("ip"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AdminAuditLogRow = typeof adminAuditLog.$inferSelect;
export type NewAdminAuditLogRow = typeof adminAuditLog.$inferInsert;

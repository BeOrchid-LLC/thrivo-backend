import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { idPk } from "./_shared";

/** Append-only record of every admin mutation (who, what, when, before/after). */
export const adminAuditLog = pgTable("admin_audit_log", {
  id: idPk(),
  actorAdminId: uuid("actor_admin_id"), // admin identity lives in the admin app; no FK here
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  before: jsonb("before"),
  after: jsonb("after"),
  requestId: text("request_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AdminAuditLogRow = typeof adminAuditLog.$inferSelect;
export type NewAdminAuditLogRow = typeof adminAuditLog.$inferInsert;

import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { idPk } from "./_shared";

/** Append-only record of every admin mutation (who, what, when, before/after). */
export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: idPk(),
    // Keep the email on the immutable audit row so entries remain readable even
    // when an admin account is disabled or later removed.
    actorAdminEmail: text("actor_admin_email").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    requestId: text("request_id"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    actorCreatedIdx: index("admin_audit_log_actor_created_idx").on(
      t.actorAdminEmail,
      t.createdAt,
      t.id
    ),
  })
);

export type AdminAuditLogRow = typeof adminAuditLog.$inferSelect;
export type NewAdminAuditLogRow = typeof adminAuditLog.$inferInsert;

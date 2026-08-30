import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { citext, idPk, timestamps } from "./_shared";
import { emailKindEnum, emailStatusEnum } from "./_enums";
import { users } from "./users";
import { emailCaptures } from "./email-captures";

/** Audit trail of every transactional send (welcome, trial-ending, cancellation, ...). */
export const emailLogs = pgTable(
  "email_logs",
  {
    id: idPk(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    leadId: uuid("lead_id").references(() => emailCaptures.id, { onDelete: "set null" }),
    parentEmailLogId: uuid("parent_email_log_id"),
    toEmail: citext("to_email").notNull(),
    template: text("template").notNull(),
    kind: emailKindEnum("kind").notNull().default("legacy_notification"),
    dedupeKey: text("dedupe_key"),
    status: emailStatusEnum("status").notNull().default("queued"),
    providerMessageId: text("provider_message_id"), // Resend message id
    attemptCount: integer("attempt_count").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    providerEventAt: timestamp("provider_event_at", { withTimezone: true }),
    failureCode: text("failure_code"),
    error: text("error"),
    resendable: boolean("resendable").notNull().default(false),
    ...timestamps,
  },
  (t) => ({
    byUserTemplateCreated: index("email_logs_user_template_created_idx")
      .on(t.userId, t.template, t.createdAt)
      .concurrently(),
    byStatusCreated: index("email_logs_status_created_idx").on(t.status, t.createdAt),
    byLeadCreated: index("email_logs_lead_created_idx").on(t.leadId, t.createdAt),
    byParent: index("email_logs_parent_idx").on(t.parentEmailLogId),
    kindDedupeUniq: uniqueIndex("email_logs_kind_dedupe_uniq")
      .on(t.kind, t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
    providerMessageUniq: uniqueIndex("email_logs_provider_message_uniq")
      .on(t.providerMessageId)
      .where(sql`${t.providerMessageId} is not null`),
    parentEmailLogFk: foreignKey({
      columns: [t.parentEmailLogId],
      foreignColumns: [t.id],
      name: "email_logs_parent_email_log_id_email_logs_id_fk",
    }).onDelete("set null"),
  })
);

export type EmailLogRow = typeof emailLogs.$inferSelect;
export type NewEmailLogRow = typeof emailLogs.$inferInsert;

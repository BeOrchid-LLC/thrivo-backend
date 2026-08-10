import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { citext, idPk, timestamps } from "./_shared";
import { emailKindEnum, emailStatusEnum } from "./_enums";
import { users } from "./users";

/** Audit trail of every transactional send (welcome, trial-ending, cancellation, ...). */
export const emailLogs = pgTable(
  "email_logs",
  {
    id: idPk(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
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
    ...timestamps,
  },
  (t) => ({
    byUserTemplateCreated: index("email_logs_user_template_created_idx")
      .on(t.userId, t.template, t.createdAt)
      .concurrently(),
    byStatusCreated: index("email_logs_status_created_idx").on(t.status, t.createdAt),
    kindDedupeUniq: uniqueIndex("email_logs_kind_dedupe_uniq")
      .on(t.kind, t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
    providerMessageUniq: uniqueIndex("email_logs_provider_message_uniq")
      .on(t.providerMessageId)
      .where(sql`${t.providerMessageId} is not null`),
  })
);

export type EmailLogRow = typeof emailLogs.$inferSelect;
export type NewEmailLogRow = typeof emailLogs.$inferInsert;

import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { citext, idPk, timestamps } from "./_shared";
import { emailStatusEnum } from "./_enums";
import { users } from "./users";

/** Audit trail of every transactional send (welcome, trial-ending, cancellation, ...). */
export const emailLogs = pgTable(
  "email_logs",
  {
    id: idPk(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    toEmail: citext("to_email").notNull(),
    template: text("template").notNull(),
    status: emailStatusEnum("status").notNull().default("queued"),
    providerMessageId: text("provider_message_id"), // Resend message id
    error: text("error"),
    ...timestamps,
  },
  (t) => ({
    byUserTemplateCreated: index("email_logs_user_template_created_idx")
      .on(t.userId, t.template, t.createdAt)
      .concurrently(),
    byStatusCreated: index("email_logs_status_created_idx").on(t.status, t.createdAt),
  })
);

export type EmailLogRow = typeof emailLogs.$inferSelect;
export type NewEmailLogRow = typeof emailLogs.$inferInsert;

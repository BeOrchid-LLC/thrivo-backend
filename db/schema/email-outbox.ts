import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { idPk, timestamps } from "./_shared";
import { emailOutboxStateEnum } from "./_enums";
import { emailLogs } from "./email-logs";

/** Durable, encrypted hand-off between PostgreSQL transactions and BullMQ. */
export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: idPk(),
    emailLogId: uuid("email_log_id")
      .notNull()
      .references(() => emailLogs.id, { onDelete: "cascade" }),
    state: emailOutboxStateEnum("state").notNull().default("pending"),
    encryptionKeyId: text("encryption_key_id").notNull(),
    payloadIv: text("payload_iv"),
    payloadAuthTag: text("payload_auth_tag"),
    payloadCiphertext: text("payload_ciphertext"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    dispatchStartedAt: timestamp("dispatch_started_at", { withTimezone: true }),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    emailLogUniq: uniqueIndex("email_outbox_email_log_uniq").on(t.emailLogId),
    pendingExpiryIdx: index("email_outbox_state_expiry_idx").on(t.state, t.expiresAt),
  })
);

export type EmailOutboxRow = typeof emailOutbox.$inferSelect;
export type NewEmailOutboxRow = typeof emailOutbox.$inferInsert;

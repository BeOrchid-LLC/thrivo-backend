import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { idPk, timestamps } from "./_shared";
import { emailLogs } from "./email-logs";

/** Short-lived encrypted payload retained only for approved admin resends. */
export const emailReplayPayloads = pgTable(
  "email_replay_payloads",
  {
    id: idPk(),
    emailLogId: uuid("email_log_id")
      .notNull()
      .unique()
      .references(() => emailLogs.id, { onDelete: "cascade" }),
    encryptionKeyId: text("encryption_key_id").notNull(),
    payloadIv: text("payload_iv").notNull(),
    payloadAuthTag: text("payload_auth_tag").notNull(),
    payloadCiphertext: text("payload_ciphertext").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => ({ expiryIdx: index("email_replay_payloads_expiry_idx").on(t.expiresAt) })
);

export type EmailReplayPayloadRow = typeof emailReplayPayloads.$inferSelect;
export type NewEmailReplayPayloadRow = typeof emailReplayPayloads.$inferInsert;

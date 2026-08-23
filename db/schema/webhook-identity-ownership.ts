import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { idPk } from "./_shared";
import { users } from "./users";
import { webhookEvents } from "./webhook-events";

/** HMAC-only ownership metadata retained after webhook payload redaction. */
export const webhookIdentityOwnership = pgTable(
  "webhook_identity_ownership",
  {
    id: idPk(),
    webhookEventId: uuid("webhook_event_id")
      .notNull()
      .references(() => webhookEvents.id, { onDelete: "cascade" }),
    identityDigest: text("identity_digest").notNull(),
    resolvedUserId: uuid("resolved_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    eventIdentityUniq: uniqueIndex("webhook_identity_event_digest_uniq").on(
      t.webhookEventId,
      t.identityDigest
    ),
    identityIdx: index("webhook_identity_digest_idx").on(t.identityDigest),
    userIdx: index("webhook_identity_resolved_user_idx").on(t.resolvedUserId),
  })
);

export type WebhookIdentityOwnershipRow = typeof webhookIdentityOwnership.$inferSelect;
export type NewWebhookIdentityOwnershipRow = typeof webhookIdentityOwnership.$inferInsert;

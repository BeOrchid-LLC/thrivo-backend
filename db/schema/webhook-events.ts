import { jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { idPk } from "./_shared";
import { webhookProviderEnum, webhookStatusEnum } from "./_enums";

/** Idempotency ledger for all inbound webhooks. unique(provider, event_id) makes replays no-ops. */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: idPk(),
    provider: webhookProviderEnum("provider").notNull(),
    eventId: text("event_id").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    status: webhookStatusEnum("status").notNull().default("received"),
    payload: jsonb("payload").notNull(),
  },
  (t) => ({
    providerEventUniq: uniqueIndex("webhook_events_provider_event_uniq").on(t.provider, t.eventId),
  })
);

export type WebhookEventRow = typeof webhookEvents.$inferSelect;
export type NewWebhookEventRow = typeof webhookEvents.$inferInsert;

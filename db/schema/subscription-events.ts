import { index, integer, pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { relations } from "drizzle-orm";
import { idPk } from "./_shared";
import { subscriptionEventTypeEnum } from "./_enums";
import { users } from "./users";
import { webhookEvents } from "./webhook-events";

/**
 * Append-only trial/subscription funnel history. `subscriptions` only holds
 * current state (one row per user), so this table is the only place queries
 * like "trials started/converted/cancelled in the last N days" can read from.
 * Populated exclusively from confirmed RevenueCat webhook deliveries (never
 * from optimistic in-app writes), so the same real-world transition can't be
 * double-counted by two different callers of persistSubscriptionAndMirror.
 *
 * `priceAmountCents`/`currency` are nullable — populated going forward from
 * RevenueCat's webhook price fields (billing-webhook.service.ts), and
 * best-effort backfilled historically for existing rows by
 * scripts/backfill-subscription-event-prices.ts. A null price means "we
 * don't know", never "$0" — this is the only source `revenueToDate`/
 * `firstChargeAmountCents` can be derived from, since `subscriptions` holds
 * no amount at all.
 */
export const subscriptionEvents = pgTable(
  "subscription_events",
  {
    id: idPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventType: subscriptionEventTypeEnum("event_type").notNull(),
    productId: text("product_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    rawEventId: uuid("raw_event_id").references(() => webhookEvents.id, { onDelete: "set null" }),
    priceAmountCents: integer("price_amount_cents"),
    currency: text("currency"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    eventTypeOccurredAtIdx: index("subscription_events_type_occurred_at_idx").on(
      t.eventType,
      t.occurredAt
    ),
    userOccurredAtIdx: index("subscription_events_user_occurred_at_idx").on(t.userId, t.occurredAt),
    rawEventUniq: uniqueIndex("subscription_events_raw_event_uniq")
      .on(t.rawEventId)
      .where(sql`${t.rawEventId} is not null`),
  })
);

export const subscriptionEventsRelations = relations(subscriptionEvents, ({ one }) => ({
  user: one(users, { fields: [subscriptionEvents.userId], references: [users.id] }),
}));

export type SubscriptionEventRow = typeof subscriptionEvents.$inferSelect;
export type NewSubscriptionEventRow = typeof subscriptionEvents.$inferInsert;

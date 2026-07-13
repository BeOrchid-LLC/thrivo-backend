import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    eventTypeOccurredAtIdx: index("subscription_events_type_occurred_at_idx").on(
      t.eventType,
      t.occurredAt
    ),
    userOccurredAtIdx: index("subscription_events_user_occurred_at_idx").on(t.userId, t.occurredAt),
  })
);

export const subscriptionEventsRelations = relations(subscriptionEvents, ({ one }) => ({
  user: one(users, { fields: [subscriptionEvents.userId], references: [users.id] }),
}));

export type SubscriptionEventRow = typeof subscriptionEvents.$inferSelect;
export type NewSubscriptionEventRow = typeof subscriptionEvents.$inferInsert;

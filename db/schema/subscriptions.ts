import { boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { idPk, timestamps } from "./_shared";
import { subProviderEnum, subStatusEnum } from "./_enums";
import { users } from "./users";

/** Projection of RevenueCat entitlement (one active row per user). RevenueCat is source of truth. */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: idPk(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    rcAppUserId: text("rc_app_user_id"),
    provider: subProviderEnum("provider").notNull(),
    productId: text("product_id"),
    status: subStatusEnum("status").notNull(),
    trialEnd: timestamp("trial_end", { withTimezone: true }),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    lastWebhookAt: timestamp("last_webhook_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    statusIdx: index("subscriptions_status_idx").on(t.status),
    periodEndIdx: index("subscriptions_period_end_idx").on(t.currentPeriodEnd),
  })
);

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  user: one(users, { fields: [subscriptions.userId], references: [users.id] }),
}));

export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type NewSubscriptionRow = typeof subscriptions.$inferInsert;

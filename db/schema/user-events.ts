import { index, jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { idPk } from "./_shared";
import { userEventTypeEnum } from "./_enums";
import { users } from "./users";

/**
 * Append-only generic product-analytics history — mirrors subscription-
 * events.ts's shape/conventions, but for lifecycle moments that aren't
 * billing-specific (onboarding completion, paywall/upgrade-prompt shown).
 * Receiving end only for now: nothing in this codebase inserts rows here
 * yet (future mobile-app instrumentation) — the admin user-detail page
 * renders these conditionally and never fabricates one.
 */
export const userEvents = pgTable(
  "user_events",
  {
    id: idPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventType: userEventTypeEnum("event_type").notNull(),
    // e.g. { trigger: "3-day streak" } for upgrade_prompt_shown.
    metadata: jsonb("metadata"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userOccurredAtIdx: index("user_events_user_occurred_at_idx").on(t.userId, t.occurredAt),
  })
);

export const userEventsRelations = relations(userEvents, ({ one }) => ({
  user: one(users, { fields: [userEvents.userId], references: [users.id] }),
}));

export type UserEventRow = typeof userEvents.$inferSelect;
export type NewUserEventRow = typeof userEvents.$inferInsert;

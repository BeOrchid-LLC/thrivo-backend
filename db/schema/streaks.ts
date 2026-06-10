import { date, integer, pgTable, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { timestamps } from "./_shared";
import { users } from "./users";

/** One streak row per user. */
export const streaks = pgTable("streaks", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  currentStreak: integer("current_streak").notNull().default(0),
  longestStreak: integer("longest_streak").notNull().default(0),
  lastLoggedDate: date("last_logged_date"),
  ...timestamps,
});

export const streaksRelations = relations(streaks, ({ one }) => ({
  user: one(users, { fields: [streaks.userId], references: [users.id] }),
}));

export type StreakRow = typeof streaks.$inferSelect;
export type NewStreakRow = typeof streaks.$inferInsert;

import { date, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { idPk } from "./_shared";
import { moodEnum } from "./_enums";
import { users } from "./users";

/** One mood check-in per user per day (premium). `tip_id` references the static tip bank. */
export const checkIns = pgTable(
  "check_ins",
  {
    id: idPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    localDate: date("local_date").notNull(),
    mood: moodEnum("mood").notNull(),
    note: text("note"),
    tipId: text("tip_id"),
    // Set by admin moderation when a note is redacted; the mobile read path
    // suppresses the note text while it is non-null. Reversible (restore = null).
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userDateUniq: uniqueIndex("check_ins_user_date_uniq").on(t.userId, t.localDate),
  })
);

export const checkInsRelations = relations(checkIns, ({ one }) => ({
  user: one(users, { fields: [checkIns.userId], references: [users.id] }),
}));

export type CheckInRow = typeof checkIns.$inferSelect;
export type NewCheckInRow = typeof checkIns.$inferInsert;

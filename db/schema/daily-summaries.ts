import { date, integer, numeric, pgTable, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { idPk, timestamps } from "./_shared";
import { users } from "./users";

/** Denormalized daily rollup (maintained by dashboard.service in A2). Powers fast reads + analytics. */
export const dailySummaries = pgTable(
  "daily_summaries",
  {
    id: idPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    localDate: date("local_date").notNull(),
    totalCalories: integer("total_calories").notNull().default(0),
    totalProteinG: numeric("total_protein_g").notNull().default("0"),
    totalCarbsG: numeric("total_carbs_g").notNull().default("0"),
    totalFatG: numeric("total_fat_g").notNull().default("0"),
    calorieTarget: integer("calorie_target"), // snapshot of the target in effect that day
    ...timestamps,
  },
  (t) => ({
    userDateUniq: uniqueIndex("daily_summaries_user_date_uniq").on(t.userId, t.localDate),
  })
);

export const dailySummariesRelations = relations(dailySummaries, ({ one }) => ({
  user: one(users, { fields: [dailySummaries.userId], references: [users.id] }),
}));

export type DailySummaryRow = typeof dailySummaries.$inferSelect;
export type NewDailySummaryRow = typeof dailySummaries.$inferInsert;

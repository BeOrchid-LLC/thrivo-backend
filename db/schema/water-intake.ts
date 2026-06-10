import { date, index, integer, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { idPk } from "./_shared";
import { users } from "./users";

/** Water tracker — daily-target semantics (premium). Canonical ml; UI converts oz/cups. */
export const waterIntake = pgTable(
  "water_intake",
  {
    id: idPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    localDate: date("local_date").notNull(),
    amountMl: integer("amount_ml").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byUserLocalDate: index("water_intake_user_local_date_idx").on(t.userId, t.localDate),
  })
);

export const waterIntakeRelations = relations(waterIntake, ({ one }) => ({
  user: one(users, { fields: [waterIntake.userId], references: [users.id] }),
}));

export type WaterIntakeRow = typeof waterIntake.$inferSelect;
export type NewWaterIntakeRow = typeof waterIntake.$inferInsert;

import { index, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { idPk } from "./_shared";
import { weightSourceEnum } from "./_enums";
import { users } from "./users";

/** Weight tracker — trend + goal-progress semantics (premium). Canonical SI; UI converts. */
export const weightEntries = pgTable(
  "weight_entries",
  {
    id: idPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    weightKg: numeric("weight_kg", { precision: 5, scale: 1 }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    source: weightSourceEnum("source").notNull().default("manual"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byUserRecordedAt: index("weight_entries_user_recorded_at_idx").on(t.userId, t.recordedAt),
  })
);

export const weightEntriesRelations = relations(weightEntries, ({ one }) => ({
  user: one(users, { fields: [weightEntries.userId], references: [users.id] }),
}));

export type WeightEntryRow = typeof weightEntries.$inferSelect;
export type NewWeightEntryRow = typeof weightEntries.$inferInsert;

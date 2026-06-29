import {
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
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
    // Client-minted key for at-least-once writes (offline-queue replay / retry).
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byUserLocalDate: index("water_intake_user_local_date_idx").on(t.userId, t.localDate),
    byUserIdempotency: uniqueIndex("water_intake_user_idempotency_uniq").on(
      t.userId,
      t.idempotencyKey
    ),
  })
);

export const waterIntakeRelations = relations(waterIntake, ({ one }) => ({
  user: one(users, { fields: [waterIntake.userId], references: [users.id] }),
}));

export type WaterIntakeRow = typeof waterIntake.$inferSelect;
export type NewWaterIntakeRow = typeof waterIntake.$inferInsert;

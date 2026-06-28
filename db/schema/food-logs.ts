import {
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { newId } from "../../src/lib/ids";
import { timestamps } from "./_shared";
import { logSourceEnum } from "./_enums";
import { users } from "./users";
import { foodItems } from "./food-items";
import { foodServings } from "./food-servings";

/**
 * The diary — hot, high-volume, partition-ready. Nutrient values + name are
 * SNAPSHOTTED at log time and never joined from the live catalog, so upstream
 * corrections/merges never rewrite a user's history. Composite PK includes
 * `logged_at` so a future `PARTITION BY RANGE (logged_at)` is a migration, not a
 * redesign (Stage 5). Catalog FKs are nullable + `set null` so deleting a food
 * item can't vaporise history.
 */
export const foodLogs = pgTable(
  "food_logs",
  {
    id: uuid("id").notNull().$defaultFn(newId),
    loggedAt: timestamp("logged_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }).notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    localDate: date("local_date").notNull(),
    source: logSourceEnum("source").notNull(),
    barcode: text("barcode"), // snapshot, not a live FK
    foodItemId: uuid("food_item_id").references(() => foodItems.id, { onDelete: "set null" }),
    servingId: uuid("serving_id").references(() => foodServings.id, { onDelete: "set null" }),

    // Snapshot columns (copied at log time).
    name: text("name").notNull(),
    servingQty: numeric("serving_qty").notNull(),
    servingUnit: text("serving_unit"),
    kcal: integer("kcal").notNull(),
    proteinG: numeric("protein_g").notNull(),
    carbsG: numeric("carbs_g").notNull(),
    fatG: numeric("fat_g").notNull(),
    // Client-minted key for at-least-once writes (offline-queue replay / retry).
    // NULLs are distinct in Postgres, so legacy key-less rows are unconstrained.
    idempotencyKey: text("idempotency_key"),
    ...timestamps,
  },
  (t) => ({
    pk: primaryKey({ columns: [t.id, t.loggedAt] }),
    byUserLocalDate: index("food_logs_user_local_date_idx").on(t.userId, t.localDate),
    byUserLoggedAt: index("food_logs_user_logged_at_idx").on(t.userId, t.loggedAt),
    byUserConsumedAt: index("food_logs_user_consumed_at_idx").on(t.userId, t.consumedAt),
    byUserIdempotency: uniqueIndex("food_logs_user_idempotency_uniq").on(
      t.userId,
      t.idempotencyKey
    ),
  })
);

export const foodLogsRelations = relations(foodLogs, ({ one }) => ({
  user: one(users, { fields: [foodLogs.userId], references: [users.id] }),
  item: one(foodItems, { fields: [foodLogs.foodItemId], references: [foodItems.id] }),
  serving: one(foodServings, { fields: [foodLogs.servingId], references: [foodServings.id] }),
}));

export type FoodLogRow = typeof foodLogs.$inferSelect;
export type NewFoodLogRow = typeof foodLogs.$inferInsert;

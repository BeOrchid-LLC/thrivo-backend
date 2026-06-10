import { integer, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { idPk } from "./_shared";
import { users } from "./users";
import { foodItems } from "./food-items";

/** Quick re-log set — powers "frequent" / "favorites" (the fastest logging path). */
export const foodFavorites = pgTable(
  "food_favorites",
  {
    id: idPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    foodItemId: uuid("food_item_id")
      .notNull()
      .references(() => foodItems.id, { onDelete: "cascade" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    useCount: integer("use_count").notNull().default(0),
  },
  (t) => ({
    userItemUniq: uniqueIndex("food_favorites_user_item_uniq").on(t.userId, t.foodItemId),
  })
);

export const foodFavoritesRelations = relations(foodFavorites, ({ one }) => ({
  user: one(users, { fields: [foodFavorites.userId], references: [users.id] }),
  item: one(foodItems, { fields: [foodFavorites.foodItemId], references: [foodItems.id] }),
}));

export type FoodFavoriteRow = typeof foodFavorites.$inferSelect;
export type NewFoodFavoriteRow = typeof foodFavorites.$inferInsert;

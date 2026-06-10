import { boolean, numeric, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { idPk } from "./_shared";
import { foodItems } from "./food-items";

/** Alternative serving sizes for one item (e.g. "1 slice" / "100 g" / "1 cup"). */
export const foodServings = pgTable("food_servings", {
  id: idPk(),
  foodItemId: uuid("food_item_id")
    .notNull()
    .references(() => foodItems.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  grams: numeric("grams").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
});

export const foodServingsRelations = relations(foodServings, ({ one }) => ({
  item: one(foodItems, {
    fields: [foodServings.foodItemId],
    references: [foodItems.id],
  }),
}));

export type FoodServingRow = typeof foodServings.$inferSelect;
export type NewFoodServingRow = typeof foodServings.$inferInsert;

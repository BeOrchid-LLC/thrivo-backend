import { check, jsonb, numeric, pgTable, smallint, text, uuid } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { nutrientBasisEnum } from "./_enums";
import { foodItems } from "./food-items";

/** Nutrition per reference amount — one row per food item. Macros required; rest patchy. */
export const foodNutrients = pgTable(
  "food_nutrients",
  {
    foodItemId: uuid("food_item_id")
      .primaryKey()
      .references(() => foodItems.id, { onDelete: "cascade" }),
    basis: nutrientBasisEnum("basis").notNull(),
    servingLabel: text("serving_label"),
    servingG: numeric("serving_g"),
    kcal: numeric("kcal").notNull(),
    proteinG: numeric("protein_g").notNull(),
    carbsG: numeric("carbs_g").notNull(),
    fatG: numeric("fat_g").notNull(),
    fiberG: numeric("fiber_g"),
    sugarG: numeric("sugar_g"),
    addedSugarG: numeric("added_sugar_g"),
    sodiumMg: numeric("sodium_mg"),
    satFatG: numeric("sat_fat_g"),
    micros: jsonb("micros"),
    novaGroup: smallint("nova_group"),
    dataCompleteness: numeric("data_completeness"),
  },
  (t) => ({
    // ADR-0022 (D1/D2): the multiplier divides by servingG whenever basis is
    // per_serving — a null/zero value there is a divide-by-zero (I1's root
    // cause). Enforced in application code too, but the DB is the backstop.
    servingGRequiredForPerServing: check(
      "food_nutrients_serving_g_required_for_per_serving",
      sql`${t.basis} <> 'per_serving' OR ${t.servingG} > 0`
    ),
  })
);

export const foodNutrientsRelations = relations(foodNutrients, ({ one }) => ({
  item: one(foodItems, {
    fields: [foodNutrients.foodItemId],
    references: [foodItems.id],
  }),
}));

export type FoodNutrientRow = typeof foodNutrients.$inferSelect;
export type NewFoodNutrientRow = typeof foodNutrients.$inferInsert;

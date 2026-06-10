import {
  type AnyPgColumn,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { idPk, timestamps, tsvector } from "./_shared";
import { foodOriginEnum, foodStatusEnum, foodTierEnum } from "./_enums";
import { users } from "./users";
import { foodNutrients } from "./food-nutrients";
import { foodServings } from "./food-servings";

/**
 * Canonical loggable food across all tiers. v1 uses `authoritative` (Open Food
 * Facts cache) + `personal`; `community` ships in Track B (the enum already
 * includes it so the schema is forward-compatible).
 */
export const foodItems = pgTable(
  "food_items",
  {
    id: idPk(),
    tier: foodTierEnum("tier").notNull(),
    status: foodStatusEnum("status").notNull().default("active"),
    origin: foodOriginEnum("origin").notNull(),
    originRef: text("origin_ref"), // USDA fdcId / OFF barcode / null
    barcode: text("barcode"),
    name: text("name").notNull(),
    brand: text("brand"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    // Set ONLY for personal (tier 3) items — enforces privacy.
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
    // Self-FK: set when deduped into a canonical item (logs already snapshotted, unaffected).
    mergedIntoId: uuid("merged_into_id").references((): AnyPgColumn => foodItems.id, {
      onDelete: "set null",
    }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    // Generated full-text vector; GIN index added in the bootstrap migration.
    searchText: tsvector("search_text").generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(brand, ''))`
    ),
    ...timestamps,
  },
  (t) => ({
    barcodeActiveUniq: uniqueIndex("food_items_barcode_active_uniq")
      .on(t.barcode)
      .where(sql`${t.status} = 'active'`),
    tierStatusIdx: index("food_items_tier_status_idx").on(t.tier, t.status),
    ownerPersonalIdx: index("food_items_owner_personal_idx")
      .on(t.ownerUserId)
      .where(sql`${t.tier} = 'personal'`),
    searchTextIdx: index("food_items_search_text_idx").using("gin", t.searchText),
  })
);

export const foodItemsRelations = relations(foodItems, ({ one, many }) => ({
  nutrients: one(foodNutrients, {
    fields: [foodItems.id],
    references: [foodNutrients.foodItemId],
  }),
  servings: many(foodServings),
  owner: one(users, { fields: [foodItems.ownerUserId], references: [users.id] }),
  mergedInto: one(foodItems, {
    fields: [foodItems.mergedIntoId],
    references: [foodItems.id],
    relationName: "merge",
  }),
}));

export type FoodItemRow = typeof foodItems.$inferSelect;
export type NewFoodItemRow = typeof foodItems.$inferInsert;

import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import {
  foodItems,
  foodNutrients,
  foodServings,
  type FoodItemRow,
  type FoodNutrientRow,
  type FoodServingRow,
  type NewFoodItemRow,
  type NewFoodNutrientRow,
  type NewFoodServingRow,
} from "../../db/schema";

export type FoodItem = FoodItemRow;

export async function findById(id: string, tx: Executor = db): Promise<FoodItem | null> {
  const [row] = await tx.select().from(foodItems).where(eq(foodItems.id, id)).limit(1);
  return row ?? null;
}

/** Barcode resolution prefers an active item (System Design §5 resolution order). */
export async function findActiveByBarcode(
  barcode: string,
  tx: Executor = db
): Promise<FoodItem | null> {
  const [row] = await tx
    .select()
    .from(foodItems)
    .where(and(eq(foodItems.barcode, barcode), eq(foodItems.status, "active")))
    .limit(1);
  return row ?? null;
}

/** Full-text search over the generated tsvector, ranked by relevance. Active items only. */
export async function searchByText(
  query: string,
  limit = 20,
  tx: Executor = db
): Promise<FoodItem[]> {
  const tsQuery = sql`plainto_tsquery('simple', ${query})`;
  return tx
    .select()
    .from(foodItems)
    .where(and(eq(foodItems.status, "active"), sql`${foodItems.searchText} @@ ${tsQuery}`))
    .orderBy(sql`ts_rank(${foodItems.searchText}, ${tsQuery}) desc`)
    .limit(limit);
}

export async function searchVisibleByText(
  userId: string,
  query: string,
  limit = 20,
  offset = 0,
  tx: Executor = db
): Promise<FoodItem[]> {
  const tsQuery = sql`plainto_tsquery('simple', ${query})`;
  return tx
    .select()
    .from(foodItems)
    .where(
      and(
        eq(foodItems.status, "active"),
        sql`${foodItems.searchText} @@ ${tsQuery}`,
        or(eq(foodItems.tier, "authoritative"), eq(foodItems.ownerUserId, userId))
      )
    )
    .orderBy(
      sql`case when ${foodItems.ownerUserId} = ${userId} then 0 else 1 end`,
      sql`ts_rank(${foodItems.searchText}, ${tsQuery}) desc`
    )
    .limit(limit)
    .offset(offset);
}

export async function insertItem(input: NewFoodItemRow, tx: Executor = db): Promise<FoodItem> {
  const [row] = await tx.insert(foodItems).values(input).returning();
  return row;
}

/** Personal describe-meal items are tagged `origin_ref = estimate` for isEstimated + reuse. */
export async function findPersonalEstimateByName(
  userId: string,
  name: string,
  tx: Executor = db
): Promise<FoodItem | null> {
  const [row] = await tx
    .select()
    .from(foodItems)
    .where(
      and(
        eq(foodItems.status, "active"),
        eq(foodItems.tier, "personal"),
        eq(foodItems.ownerUserId, userId),
        eq(foodItems.originRef, "estimate"),
        sql`lower(${foodItems.name}) = lower(${name})`
      )
    )
    .limit(1);
  return row ?? null;
}

/** Active personal item owned by the user with an exact case-insensitive name match. */
export async function findPersonalByName(
  userId: string,
  name: string,
  tx: Executor = db
): Promise<FoodItem | null> {
  const [row] = await tx
    .select()
    .from(foodItems)
    .where(
      and(
        eq(foodItems.status, "active"),
        eq(foodItems.tier, "personal"),
        eq(foodItems.ownerUserId, userId),
        sql`lower(${foodItems.name}) = lower(${name})`
      )
    )
    .limit(1);
  return row ?? null;
}

export async function updateItem(
  id: string,
  patch: Partial<NewFoodItemRow>,
  tx: Executor = db
): Promise<FoodItem | null> {
  const [row] = await tx.update(foodItems).set(patch).where(eq(foodItems.id, id)).returning();
  return row ?? null;
}

/** Upsert reference nutrition (1 row per item). */
export async function upsertNutrients(
  input: NewFoodNutrientRow,
  tx: Executor = db
): Promise<FoodNutrientRow> {
  const [row] = await tx
    .insert(foodNutrients)
    .values(input)
    .onConflictDoUpdate({ target: foodNutrients.foodItemId, set: input })
    .returning();
  return row;
}

export async function getNutrients(
  foodItemId: string,
  tx: Executor = db
): Promise<FoodNutrientRow | null> {
  const [row] = await tx
    .select()
    .from(foodNutrients)
    .where(eq(foodNutrients.foodItemId, foodItemId))
    .limit(1);
  return row ?? null;
}

export async function getServings(
  foodItemId: string,
  tx: Executor = db
): Promise<FoodServingRow[]> {
  return tx.select().from(foodServings).where(eq(foodServings.foodItemId, foodItemId));
}

export interface FoodItemWithNutrients {
  item: FoodItem;
  nutrient: FoodNutrientRow;
}

/**
 * Batch fetch of items + their reference nutrition, one joined round-trip
 * over the given ids (R5-1). Items with no nutrition row are excluded, same
 * as the single-id `findById` + `getNutrients` path they replace for fan-outs.
 */
export async function findManyWithNutrients(
  ids: string[],
  tx: Executor = db
): Promise<FoodItemWithNutrients[]> {
  if (ids.length === 0) return [];
  return tx
    .select({ item: foodItems, nutrient: foodNutrients })
    .from(foodItems)
    .innerJoin(foodNutrients, eq(foodNutrients.foodItemId, foodItems.id))
    .where(inArray(foodItems.id, ids));
}

/** Batch serving options for many items in one round-trip (R5-1). */
export async function getServingsForItems(
  ids: string[],
  tx: Executor = db
): Promise<FoodServingRow[]> {
  if (ids.length === 0) return [];
  return tx.select().from(foodServings).where(inArray(foodServings.foodItemId, ids));
}

export async function insertServing(
  input: NewFoodServingRow,
  tx: Executor = db
): Promise<FoodServingRow> {
  const [row] = await tx.insert(foodServings).values(input).returning();
  return row;
}

export async function deleteServings(foodItemId: string, tx: Executor = db): Promise<void> {
  await tx.delete(foodServings).where(eq(foodServings.foodItemId, foodItemId));
}

/**
 * Batch page of active, OFF-sourced catalog items ordered by id — the R1-5
 * backfill's checkpointable unit of work (`gt(id, afterId)` resumes where a
 * prior run left off).
 */
export async function listOpenFoodFactsItemsAfter(
  afterId: string | null,
  limit: number,
  tx: Executor = db
): Promise<FoodItem[]> {
  return tx
    .select()
    .from(foodItems)
    .where(
      and(
        eq(foodItems.origin, "openfoodfacts"),
        eq(foodItems.status, "active"),
        afterId ? sql`${foodItems.id} > ${afterId}` : sql`true`
      )
    )
    .orderBy(foodItems.id)
    .limit(limit);
}

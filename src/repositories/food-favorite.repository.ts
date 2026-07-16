import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { foodFavorites, type FoodFavoriteRow, type NewFoodFavoriteRow } from "../../db/schema";

export type FoodFavorite = FoodFavoriteRow;

export async function listForUser(userId: string, tx: Executor = db): Promise<FoodFavorite[]> {
  return tx
    .select()
    .from(foodFavorites)
    .where(eq(foodFavorites.userId, userId))
    .orderBy(desc(foodFavorites.useCount), desc(foodFavorites.lastUsedAt));
}

export async function listIdsForUser(userId: string, tx: Executor = db): Promise<Set<string>> {
  const rows = await tx
    .select({ foodItemId: foodFavorites.foodItemId })
    .from(foodFavorites)
    .where(eq(foodFavorites.userId, userId));
  return new Set(rows.map((row) => row.foodItemId));
}

export async function listMatchingIdsForUser(
  userId: string,
  foodItemIds: readonly string[],
  tx: Executor = db
): Promise<Set<string>> {
  const uniqueIds = Array.from(new Set(foodItemIds));
  if (uniqueIds.length === 0) return new Set();
  const rows = await tx
    .select({ foodItemId: foodFavorites.foodItemId })
    .from(foodFavorites)
    .where(and(eq(foodFavorites.userId, userId), inArray(foodFavorites.foodItemId, uniqueIds)));
  return new Set(rows.map((row) => row.foodItemId));
}

/** Idempotent add — unique(user_id, food_item_id) makes a repeat a no-op touch. */
export async function addFavorite(
  input: NewFoodFavoriteRow,
  tx: Executor = db
): Promise<FoodFavorite> {
  const [row] = await tx
    .insert(foodFavorites)
    .values(input)
    .onConflictDoUpdate({
      target: [foodFavorites.userId, foodFavorites.foodItemId],
      set: { lastUsedAt: new Date() },
    })
    .returning();
  return row;
}

export async function bumpUseCount(
  userId: string,
  foodItemId: string,
  tx: Executor = db
): Promise<void> {
  await tx
    .update(foodFavorites)
    .set({ useCount: sql`${foodFavorites.useCount} + 1`, lastUsedAt: new Date() })
    .where(and(eq(foodFavorites.userId, userId), eq(foodFavorites.foodItemId, foodItemId)));
}

export async function removeFavorite(
  userId: string,
  foodItemId: string,
  tx: Executor = db
): Promise<void> {
  await tx
    .delete(foodFavorites)
    .where(and(eq(foodFavorites.userId, userId), eq(foodFavorites.foodItemId, foodItemId)));
}

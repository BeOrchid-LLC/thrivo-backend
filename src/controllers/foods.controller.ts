import type { Context } from "hono";
import {
  addFavoritePayloadSchema,
  deleteLogParamsSchema,
  estimateFoodPayloadSchema,
  favoriteParamsSchema,
  foodDetailParamsSchema,
  foodLogDayQuerySchema,
  foodLogHistoryQuerySchema,
  foodLookupQuerySchema,
  foodSearchQuerySchema,
  logEstimatePayloadSchema,
  logFoodPayloadSchema,
  recentFoodsQuerySchema,
  updateLogPayloadSchema,
  upsertFoodPayloadSchema,
} from "../../contracts/src/foods";
import { readIdempotencyKey } from "../lib/idempotency";
import { respondOk } from "../lib/response";
import { getValidatedInput } from "../middleware/validate";
import { getFoodEntriesForDay, getHistoryDays } from "../services/dashboard.service";
import { estimateNutrition } from "../services/estimate.service";
import {
  addFavorite,
  createPersonalFood,
  deleteFoodLog,
  getFoodDetail,
  listFavorites,
  logEstimate,
  logFood,
  lookupFood,
  recentFoods,
  removeFavorite,
  searchFoods,
  updateFoodLog,
  updatePersonalFood,
} from "../services/food.service";
import type { AppEnv } from "../types/http";

export async function lookupFoodByBarcode(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const { barcode } = foodLookupQuerySchema.parse(getValidatedInput(c, "query"));
  const food = await lookupFood(user, barcode);
  return respondOk(c, { food });
}

export async function searchFoodItems(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const { q } = foodSearchQuerySchema.parse(getValidatedInput(c, "query"));
  const items = await searchFoods(user, q);
  return respondOk(c, { items });
}

export async function getFoodItem(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const { id } = foodDetailParamsSchema.parse(getValidatedInput(c, "param"));
  const food = await getFoodDetail(user, id);
  return respondOk(c, { food });
}

export async function createFoodItem(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const input = upsertFoodPayloadSchema.parse(getValidatedInput(c, "json"));
  const food = await createPersonalFood(user, input);
  return respondOk(c, { food }, "Created", 201);
}

export async function updateFoodItem(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const { id } = foodDetailParamsSchema.parse(getValidatedInput(c, "param"));
  const input = upsertFoodPayloadSchema.parse(getValidatedInput(c, "json"));
  const food = await updatePersonalFood(user, id, input);
  return respondOk(c, { food });
}

export async function createFoodLog(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const input = logFoodPayloadSchema.parse(getValidatedInput(c, "json"));
  const result = await logFood(user, input, readIdempotencyKey(c));
  return respondOk(c, result, "Created", 201);
}

export async function createEstimateLog(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const input = logEstimatePayloadSchema.parse(getValidatedInput(c, "json"));
  const result = await logEstimate(user, input, readIdempotencyKey(c));
  return respondOk(c, result, "Created", 201);
}

export async function patchFoodLog(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const { id } = deleteLogParamsSchema.parse(getValidatedInput(c, "param"));
  const input = updateLogPayloadSchema.parse(getValidatedInput(c, "json"));
  const result = await updateFoodLog(user, id, input);
  return respondOk(c, result);
}

export async function removeFoodLog(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const { id } = deleteLogParamsSchema.parse(getValidatedInput(c, "param"));
  await deleteFoodLog(user, id);
  return respondOk(c, { ok: true });
}

export async function getFoodLogDay(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const { date } = foodLogDayQuerySchema.parse(getValidatedInput(c, "query"));
  const entries = await getFoodEntriesForDay(user, date);
  return respondOk(c, { day: date, entries, isEmptyDay: entries.length === 0 });
}

export async function getFoodLogHistory(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const query = foodLogHistoryQuerySchema.parse(getValidatedInput(c, "query"));
  const history = await getHistoryDays(user, query);
  return respondOk(c, history);
}

export async function getRecentFoods(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const query = recentFoodsQuerySchema.parse(getValidatedInput(c, "query"));
  const items = await recentFoods(user, query.limit ?? 20);
  return respondOk(c, { items });
}

export async function getFavorites(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const items = await listFavorites(user);
  return respondOk(c, { items });
}

export async function createFavorite(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const { foodItemId } = addFavoritePayloadSchema.parse(getValidatedInput(c, "json"));
  const items = await addFavorite(user, foodItemId);
  return respondOk(c, { items }, "Created", 201);
}

export async function deleteFavorite(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const { id } = favoriteParamsSchema.parse(getValidatedInput(c, "param"));
  const items = await removeFavorite(user, id);
  return respondOk(c, { items });
}

export async function estimateFoodEntry(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const input = estimateFoodPayloadSchema.parse(getValidatedInput(c, "json"));
  const nutrients = await estimateNutrition(user.id, input);
  const estimate = {
    name: input.name,
    servingUnit: input.portionMeasure,
    quantity: input.quantity,
    nutrients,
    isEstimated: true as const,
  };
  return respondOk(c, { estimate });
}

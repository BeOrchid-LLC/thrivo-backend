import { db } from "../../db";
import type {
  FoodItem,
  FoodLogEntry,
  Nutrients,
  ServingOption,
  UpsertFoodPayload,
  LogFoodPayload,
  UpdateLogPayload,
  EstimateFoodPayload,
  LogEstimatePayload,
} from "../../contracts/src/foods";
import { ConflictError, ForbiddenError, NotFoundError } from "../lib/errors";
import { dailySummaryRepo, foodFavoriteRepo, foodItemRepo, foodLogRepo } from "../repositories";
import type { FoodLog } from "../repositories/food-log.repository";
import type { User } from "../repositories/user.repository";
import { fetchOpenFoodFactsProduct } from "../integrations/open-food-facts";
import { invalidateFoodDashboardCache } from "./dashboard-cache.service";

const DEFAULT_TARGET_CALORIES = 1800;

export async function lookupFood(user: User, barcode: string): Promise<FoodItem | null> {
  const cached = await foodItemRepo.findActiveByBarcode(barcode);
  if (cached && canSeeFood(user, cached)) return toFoodItem(cached.id);

  const upstream = await fetchOpenFoodFactsProduct(barcode);
  if (!upstream) return null;

  const created = await db.transaction(async (tx) => {
    const existing = await foodItemRepo.findActiveByBarcode(barcode, tx);
    if (existing) return existing;
    const item = await foodItemRepo.insertItem(
      {
        tier: "authoritative",
        status: "active",
        origin: "openfoodfacts",
        originRef: barcode,
        barcode,
        name: upstream.name,
        brand: upstream.brand,
      },
      tx
    );
    await foodItemRepo.upsertNutrients(
      {
        foodItemId: item.id,
        basis: upstream.servingGrams ? "per_serving" : "per_100g",
        servingLabel: upstream.servingLabel,
        servingG: upstream.servingGrams ? String(upstream.servingGrams) : null,
        kcal: String(upstream.nutrients.calories),
        proteinG: String(upstream.nutrients.proteinG),
        carbsG: String(upstream.nutrients.carbsG),
        fatG: String(upstream.nutrients.fatG),
        dataCompleteness: "0.7",
      },
      tx
    );
    if (upstream.servingGrams) {
      await foodItemRepo.insertServing(
        {
          foodItemId: item.id,
          label: upstream.servingLabel,
          grams: String(upstream.servingGrams),
          isDefault: true,
        },
        tx
      );
    }
    return item;
  });

  return toFoodItem(created.id);
}

export async function searchFoods(user: User, query: string): Promise<FoodItem[]> {
  const items = await foodItemRepo.searchVisibleByText(user.id, query);
  return Promise.all(items.map((item) => toFoodItem(item.id))).then((results) =>
    results.filter((item): item is FoodItem => item !== null)
  );
}

export async function getFoodDetail(user: User, id: string): Promise<FoodItem> {
  const item = await foodItemRepo.findById(id);
  if (!item || !canSeeFood(user, item)) throw new NotFoundError("Food not found");
  const mapped = await toFoodItem(id);
  if (!mapped) throw new NotFoundError("Food not found");
  return mapped;
}

export async function createPersonalFood(user: User, payload: UpsertFoodPayload): Promise<FoodItem> {
  const item = await db.transaction(async (tx) => {
    const created = await foodItemRepo.insertItem(
      {
        tier: "personal",
        status: "active",
        origin: "personal",
        name: payload.name,
        brand: payload.brand ?? null,
        barcode: payload.barcode ?? null,
        createdBy: user.id,
        ownerUserId: user.id,
      },
      tx
    );
    await writeNutrition(created.id, payload, tx);
    return created;
  });
  const mapped = await toFoodItem(item.id);
  if (!mapped) throw new NotFoundError("Food not found");
  return mapped;
}

export async function updatePersonalFood(
  user: User,
  id: string,
  payload: UpsertFoodPayload
): Promise<FoodItem> {
  const existing = await foodItemRepo.findById(id);
  if (!existing || existing.ownerUserId !== user.id || existing.tier !== "personal") {
    throw new NotFoundError("Food not found");
  }
  const updated = await db.transaction(async (tx) => {
    const row = await foodItemRepo.updateItem(
      id,
      {
        name: payload.name,
        brand: payload.brand ?? null,
        barcode: payload.barcode ?? null,
        updatedAt: new Date(),
      },
      tx
    );
    await writeNutrition(id, payload, tx);
    return row;
  });
  if (!updated) throw new NotFoundError("Food not found");
  const mapped = await toFoodItem(updated.id);
  if (!mapped) throw new NotFoundError("Food not found");
  return mapped;
}

export async function listFavorites(user: User): Promise<FoodItem[]> {
  const favorites = await foodFavoriteRepo.listForUser(user.id);
  const items = await Promise.all(favorites.map((favorite) => toFoodItem(favorite.foodItemId)));
  return items.filter((item): item is FoodItem => item !== null);
}

export async function addFavorite(user: User, foodItemId: string): Promise<FoodItem[]> {
  await getFoodDetail(user, foodItemId);
  await foodFavoriteRepo.addFavorite({ userId: user.id, foodItemId, lastUsedAt: new Date() });
  return listFavorites(user);
}

export async function removeFavorite(user: User, foodItemId: string): Promise<FoodItem[]> {
  await foodFavoriteRepo.removeFavorite(user.id, foodItemId);
  return listFavorites(user);
}

export async function logFood(user: User, payload: LogFoodPayload) {
  const item = await foodItemRepo.findById(payload.foodItemId);
  if (!item || !canSeeFood(user, item)) throw new NotFoundError("Food not found");
  const nutrient = await foodItemRepo.getNutrients(item.id);
  if (!nutrient) throw new ConflictError("Food has no nutrition data");
  const servings = await foodItemRepo.getServings(item.id);
  const serving = payload.servingId
    ? servings.find((candidate) => candidate.id === payload.servingId)
    : null;
  const baseGrams = toNumber(nutrient.servingG);
  const servingGrams = toNumber(serving?.grams);
  const multiplier =
    servingGrams && baseGrams ? payload.servings * (servingGrams / baseGrams) : payload.servings;
  const consumedAt = payload.consumedAt ? new Date(payload.consumedAt) : new Date();
  const now = new Date();
  const log = await foodLogRepo.createLog({
    userId: user.id,
    loggedAt: now,
    consumedAt,
    localDate: payload.day,
    source: item.barcode ? "barcode" : "search",
    barcode: item.barcode,
    foodItemId: item.id,
    servingId: serving?.id ?? payload.servingId ?? null,
    name: item.name,
    servingQty: String(payload.servings),
    servingUnit: payload.servingUnit ?? serving?.label ?? nutrient.servingLabel,
    kcal: Math.round(toNumber(nutrient.kcal) * multiplier),
    proteinG: String(toNumber(nutrient.proteinG) * multiplier),
    carbsG: String(toNumber(nutrient.carbsG) * multiplier),
    fatG: String(toNumber(nutrient.fatG) * multiplier),
  });
  await foodFavoriteRepo.bumpUseCount(user.id, item.id);
  await refreshDailySummary(user, payload.day);
  await invalidateFoodDashboardCache(user.id, payload.day);
  return mutationResult(user, log, payload.day);
}

export function estimateFood(payload: EstimateFoodPayload) {
  const unit = payload.portionMeasure;
  const quantity = payload.quantity;
  const text = `${payload.name} ${payload.ingredients ?? ""} ${payload.cookingMethod ?? ""}`.toLowerCase();
  const baseCalories = estimateCalories(text, unit);
  const nutrients = macroSplit(baseCalories * quantity, text);
  return {
    name: payload.name,
    servingUnit: unit,
    quantity,
    nutrients,
    isEstimated: true as const,
  };
}

export async function logEstimate(user: User, payload: LogEstimatePayload) {
  const consumedAt = payload.consumedAt ? new Date(payload.consumedAt) : new Date();
  const now = new Date();
  const log = await foodLogRepo.createLog({
    userId: user.id,
    loggedAt: now,
    consumedAt,
    localDate: payload.day,
    source: "manual",
    foodItemId: null,
    servingId: null,
    barcode: null,
    name: payload.name,
    servingQty: String(payload.quantity),
    servingUnit: payload.servingUnit ?? payload.portionMeasure,
    kcal: Math.round(payload.nutrients.calories),
    proteinG: String(payload.nutrients.proteinG),
    carbsG: String(payload.nutrients.carbsG),
    fatG: String(payload.nutrients.fatG),
  });
  await refreshDailySummary(user, payload.day);
  await invalidateFoodDashboardCache(user.id, payload.day);
  return mutationResult(user, log, payload.day);
}

export async function updateFoodLog(user: User, id: string, payload: UpdateLogPayload) {
  const existing = await foodLogRepo.findLogForUser(user.id, id);
  if (!existing) throw new NotFoundError("Food log not found");
  const nextServings = payload.servings ?? toNumber(existing.servingQty);
  const currentServings = toNumber(existing.servingQty) || 1;
  const ratio = nextServings / currentServings;
  const patch = {
    servingQty: String(nextServings),
    servingId: payload.servingId === undefined ? existing.servingId : payload.servingId,
    servingUnit: payload.servingUnit === undefined ? existing.servingUnit : payload.servingUnit,
    consumedAt: payload.consumedAt ? new Date(payload.consumedAt) : existing.consumedAt,
    kcal: Math.round(existing.kcal * ratio),
    proteinG: String(toNumber(existing.proteinG) * ratio),
    carbsG: String(toNumber(existing.carbsG) * ratio),
    fatG: String(toNumber(existing.fatG) * ratio),
    updatedAt: new Date(),
  };
  const updated = await foodLogRepo.updateLogForUser(user.id, id, patch);
  if (!updated) throw new NotFoundError("Food log not found");
  await refreshDailySummary(user, updated.localDate);
  await invalidateFoodDashboardCache(user.id, updated.localDate);
  return mutationResult(user, updated, updated.localDate);
}

export async function deleteFoodLog(user: User, id: string) {
  const deleted = await foodLogRepo.deleteLogForUser(user.id, id);
  if (!deleted) throw new NotFoundError("Food log not found");
  await refreshDailySummary(user, deleted.localDate);
  await invalidateFoodDashboardCache(user.id, deleted.localDate);
}

export async function recentFoods(user: User, limit = 20): Promise<FoodLogEntry[]> {
  const logs = await foodLogRepo.listRecentLogs(user.id, limit);
  return logs.map(toFoodLogEntry);
}

async function writeNutrition(foodItemId: string, payload: UpsertFoodPayload, tx: Parameters<typeof foodItemRepo.upsertNutrients>[1]) {
  await foodItemRepo.upsertNutrients(
    {
      foodItemId,
      basis: payload.servingGrams ? "per_serving" : "per_100g",
      servingLabel: payload.servingLabel,
      servingG: payload.servingGrams ? String(payload.servingGrams) : null,
      kcal: String(payload.nutrients.calories),
      proteinG: String(payload.nutrients.proteinG),
      carbsG: String(payload.nutrients.carbsG),
      fatG: String(payload.nutrients.fatG),
      dataCompleteness: "1",
    },
    tx
  );
  await foodItemRepo.deleteServings(foodItemId, tx);
  if (payload.servingGrams) {
    await foodItemRepo.insertServing(
      {
        foodItemId,
        label: payload.servingLabel,
        grams: String(payload.servingGrams),
        isDefault: true,
      },
      tx
    );
  }
}

async function toFoodItem(id: string): Promise<FoodItem | null> {
  const item = await foodItemRepo.findById(id);
  if (!item) return null;
  const nutrient = await foodItemRepo.getNutrients(id);
  if (!nutrient) return null;
  const servings = await foodItemRepo.getServings(id);
  const servingGrams = toNumber(nutrient.servingG);
  return {
    id: item.id,
    name: item.name,
    brand: item.brand,
    barcode: item.barcode,
    source: item.tier,
    servingLabel: nutrient.servingLabel ?? "serving",
    servingGrams,
    nutrients: {
      calories: toNumber(nutrient.kcal),
      proteinG: toNumber(nutrient.proteinG),
      carbsG: toNumber(nutrient.carbsG),
      fatG: toNumber(nutrient.fatG),
    },
    servingOptions: buildServingOptions(nutrient.servingLabel ?? "serving", servingGrams, servings),
    isPersonal: item.tier === "personal",
    isEstimated: false,
  };
}

function buildServingOptions(
  defaultLabel: string,
  defaultGrams: number,
  servings: Awaited<ReturnType<typeof foodItemRepo.getServings>>
): ServingOption[] {
  const options: ServingOption[] = [
    { id: null, measure: "serving", label: defaultLabel, grams: defaultGrams || null, isDefault: true },
    { id: null, measure: "weight", label: "grams", grams: 1, isDefault: false },
  ];
  for (const serving of servings) {
    if (options.some((option) => option.id === serving.id || option.label === serving.label)) continue;
    options.push({
      id: serving.id,
      measure: inferMeasure(serving.label),
      label: serving.label,
      grams: toNumber(serving.grams),
      isDefault: serving.isDefault,
    });
  }
  return options;
}

function inferMeasure(label: string): ServingOption["measure"] {
  const normalized = label.toLowerCase();
  if (normalized.includes("cup")) return "cup";
  if (normalized.includes("tbsp") || normalized.includes("tablespoon")) return "tbsp";
  if (normalized.includes("piece") || normalized.includes("slice") || normalized.includes("bar")) {
    return "piece";
  }
  return "serving";
}

async function mutationResult(user: User, log: FoodLog, day: string) {
  return {
    entry: toFoodLogEntry(log),
    totals: await dailyTotals(user, day),
  };
}

function toFoodLogEntry(log: FoodLog): FoodLogEntry {
  return {
    id: log.id,
    foodItemId: log.foodItemId,
    name: log.name,
    day: log.localDate,
    servings: toNumber(log.servingQty) || 1,
    servingUnit: log.servingUnit,
    source: log.source,
    barcode: log.barcode,
    isEstimated: log.foodItemId === null && log.source === "manual",
    nutrients: {
      calories: log.kcal,
      proteinG: toNumber(log.proteinG),
      carbsG: toNumber(log.carbsG),
      fatG: toNumber(log.fatG),
    },
    consumedAt: log.consumedAt.toISOString(),
    loggedAt: log.loggedAt.toISOString(),
  };
}

async function refreshDailySummary(user: User, day: string) {
  const totals = await dailyTotals(user, day);
  await dailySummaryRepo.upsertForDay({
    userId: user.id,
    localDate: day,
    totalCalories: totals.calories,
    totalProteinG: String(totals.proteinG),
    totalCarbsG: String(totals.carbsG),
    totalFatG: String(totals.fatG),
    calorieTarget: user.manualDailyTargetKcal ?? user.dailyTargetKcal ?? DEFAULT_TARGET_CALORIES,
  });
}

async function dailyTotals(user: User, day: string) {
  const totals = await foodLogRepo.totalsForDay(user.id, day);
  return {
    day,
    calories: totals.calories,
    proteinG: totals.proteinG,
    carbsG: totals.carbsG,
    fatG: totals.fatG,
  };
}

function canSeeFood(user: User, item: { tier: string; ownerUserId: string | null }) {
  return item.tier === "authoritative" || item.ownerUserId === user.id;
}

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function estimateCalories(text: string, measure: EstimateFoodPayload["portionMeasure"]) {
  let base = 180;
  if (/rice|yam|pasta|noodle|bread|oat/.test(text)) base = 220;
  if (/chicken|beef|fish|egg|turkey|suya/.test(text)) base = 260;
  if (/soup|stew/.test(text)) base = 160;
  if (/yoghurt|yogurt|milk/.test(text)) base = 120;
  if (/oil|fried|butter|cream|palm/.test(text)) base += 90;
  if (measure === "weight") return base / 100;
  if (measure === "cup") return base * 1.2;
  if (measure === "tbsp") return base / 8;
  return base;
}

function macroSplit(calories: number, text: string): Nutrients {
  const highProtein = /chicken|beef|fish|egg|turkey|suya|yoghurt|yogurt/.test(text);
  const proteinCalories = highProtein ? calories * 0.38 : calories * 0.2;
  const fatCalories = /oil|fried|butter|cream|palm/.test(text) ? calories * 0.35 : calories * 0.25;
  const carbsCalories = Math.max(calories - proteinCalories - fatCalories, 0);
  return {
    calories: Math.round(calories),
    proteinG: Math.round(proteinCalories / 4),
    carbsG: Math.round(carbsCalories / 4),
    fatG: Math.round(fatCalories / 9),
  };
}

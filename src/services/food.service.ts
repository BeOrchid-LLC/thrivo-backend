import { db } from "../../db";
import type { Executor } from "../../db/tx";
import type {
  FoodItem,
  FoodLogEntry,
  FoodSearchResult,
  ServingOption,
  UpsertFoodPayload,
  LogFoodPayload,
  UpdateLogPayload,
  LogEstimatePayload,
} from "../../contracts/src/foods";
import {
  ConflictError,
  NotFoundError,
  RateLimitedError,
  UpstreamError,
  ValidationError,
} from "../lib/errors";
import {
  GRAMS_SERVING_ID,
  assertSupportedBasis,
  resolveQuantityGrams,
  scaleNutrients,
} from "../lib/nutrition";
import { dailySummaryRepo, foodFavoriteRepo, foodItemRepo, foodLogRepo } from "../repositories";
import { recordQualifyingDay } from "./streak.service";
import type { FoodLog } from "../repositories/food-log.repository";
import type { FoodServingRow } from "../../db/schema";
import type { User } from "../repositories/user.repository";
import { fetchOpenFoodFactsProduct } from "../integrations/open-food-facts";
import { invalidateFoodDashboardCache } from "./dashboard-cache.service";
import { enforceBarcodeLookupLimit, searchExternalFoods } from "./food-external.service";

const DEFAULT_TARGET_CALORIES = 1800;

export async function lookupFood(user: User, barcode: string): Promise<FoodItem | null> {
  const cached = await foodItemRepo.findActiveByBarcode(barcode);
  if (cached && canSeeFood(user, cached)) return toFoodItem(cached.id);

  let upstream;
  try {
    await enforceBarcodeLookupLimit(user.id);
    upstream = await fetchOpenFoodFactsProduct(barcode);
  } catch (err) {
    if (err instanceof RateLimitedError) throw err;
    throw new UpstreamError("Could not look up barcode right now", err);
  }
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
        basis: upstream.basis,
        servingLabel: upstream.servingLabel,
        // The reference amount is only ever servingGrams when the whole product
        // was normalized on that basis (ADR-0022/D1) — a per_100g product may
        // still carry a display-only servingGrams hint that isn't the divisor.
        servingG: upstream.basis === "per_serving" ? String(upstream.servingGrams) : null,
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

export async function searchFoods(
  user: User,
  query: string,
  limit: number
): Promise<{ items: FoodSearchResult[]; cached: boolean }> {
  return searchExternalFoods(user.id, query, limit);
}

export async function getFoodDetail(user: User, id: string): Promise<FoodItem> {
  const item = await foodItemRepo.findById(id);
  if (!item || !canSeeFood(user, item)) throw new NotFoundError("Food not found");
  const mapped = await toFoodItem(id);
  if (!mapped) throw new NotFoundError("Food not found");
  return mapped;
}

export async function createPersonalFood(
  user: User,
  payload: UpsertFoodPayload
): Promise<FoodItem> {
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

export async function logFood(user: User, payload: LogFoodPayload, idempotencyKey?: string | null) {
  if (payload.externalFood) {
    return logExternalFood(user, payload, idempotencyKey);
  }
  if (!payload.foodItemId) throw new ConflictError("Food item is required");
  const item = await foodItemRepo.findById(payload.foodItemId);
  if (!item || !canSeeFood(user, item)) throw new NotFoundError("Food not found");
  const nutrient = await foodItemRepo.getNutrients(item.id);
  if (!nutrient) throw new ConflictError("Food has no nutrition data");
  const servings = await foodItemRepo.getServings(item.id);
  const serving = resolveNamedServing(payload.servingId, servings);
  const basis = {
    basis: assertSupportedBasis(nutrient.basis),
    servingG: toNumber(nutrient.servingG) || null,
    kcal: toNumber(nutrient.kcal),
    proteinG: toNumber(nutrient.proteinG),
    carbsG: toNumber(nutrient.carbsG),
    fatG: toNumber(nutrient.fatG),
  };
  const quantityGrams = resolveQuantityGrams(
    {
      servingId: payload.servingId ?? null,
      quantity: payload.servings,
      matchedServingGrams: serving ? toNumber(serving.grams) : null,
    },
    basis
  );
  const scaled = scaleNutrients(basis, quantityGrams);
  const consumedAt = payload.consumedAt ? new Date(payload.consumedAt) : new Date();
  const now = new Date();
  const { log, totals } = await db.transaction(async (tx) => {
    const log = await foodLogRepo.createLog(
      {
        userId: user.id,
        idempotencyKey: idempotencyKey ?? null,
        loggedAt: now,
        consumedAt,
        localDate: payload.day,
        source: item.barcode ? "barcode" : "search",
        barcode: item.barcode,
        foodItemId: item.id,
        // Only a real food_servings row is FK-storable; the grams sentinel and
        // "no explicit serving" both persist as null (the snapshot columns below
        // already capture what was actually logged).
        servingId: serving?.id ?? null,
        name: item.name,
        servingQty: String(payload.servings),
        servingUnit:
          payload.servingUnit ??
          serving?.label ??
          (payload.servingId === GRAMS_SERVING_ID ? "g" : nutrient.servingLabel),
        kcal: scaled.kcal,
        proteinG: String(scaled.proteinG),
        carbsG: String(scaled.carbsG),
        fatG: String(scaled.fatG),
      },
      tx
    );
    await foodFavoriteRepo.bumpUseCount(user.id, item.id, tx);
    const totals = await refreshDailySummary(user, payload.day, tx);
    await recordQualifyingDay(user.id, payload.day, tx);
    return { log, totals };
  });
  await invalidateFoodDashboardCache(user.id, payload.day);
  return mutationResult(log, totals);
}

async function logExternalFood(
  user: User,
  payload: LogFoodPayload,
  idempotencyKey?: string | null
) {
  const snapshot = payload.externalFood;
  if (!snapshot) throw new ConflictError("Food snapshot is required");
  const consumedAt = payload.consumedAt ? new Date(payload.consumedAt) : new Date();
  const now = new Date();
  const { log, totals } = await db.transaction(async (tx) => {
    const log = await foodLogRepo.createLog(
      {
        userId: user.id,
        idempotencyKey: idempotencyKey ?? null,
        loggedAt: now,
        consumedAt,
        localDate: payload.day,
        source: "search",
        barcode: snapshot.barcode ?? null,
        foodItemId: null,
        servingId: null,
        name: snapshot.name,
        servingQty: String(payload.servings),
        servingUnit: payload.servingUnit ?? snapshot.servingLabel,
        kcal: Math.round(snapshot.nutrients.calories * payload.servings),
        proteinG: String(snapshot.nutrients.proteinG * payload.servings),
        carbsG: String(snapshot.nutrients.carbsG * payload.servings),
        fatG: String(snapshot.nutrients.fatG * payload.servings),
      },
      tx
    );
    const totals = await refreshDailySummary(user, payload.day, tx);
    await recordQualifyingDay(user.id, payload.day, tx);
    return { log, totals };
  });
  await invalidateFoodDashboardCache(user.id, payload.day);
  return mutationResult(log, totals);
}

export async function logEstimate(
  user: User,
  payload: LogEstimatePayload,
  idempotencyKey?: string | null
) {
  const consumedAt = payload.consumedAt ? new Date(payload.consumedAt) : new Date();
  const now = new Date();
  const { log, totals } = await db.transaction(async (tx) => {
    const log = await foodLogRepo.createLog(
      {
        userId: user.id,
        idempotencyKey: idempotencyKey ?? null,
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
      },
      tx
    );
    const totals = await refreshDailySummary(user, payload.day, tx);
    await recordQualifyingDay(user.id, payload.day, tx);
    return { log, totals };
  });
  await invalidateFoodDashboardCache(user.id, payload.day);
  return mutationResult(log, totals);
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
  const { updated, totals } = await db.transaction(async (tx) => {
    const updated = await foodLogRepo.updateLogForUser(user.id, id, patch, tx);
    if (!updated) throw new NotFoundError("Food log not found");
    const totals = await refreshDailySummary(user, updated.localDate, tx);
    return { updated, totals };
  });
  await invalidateFoodDashboardCache(user.id, updated.localDate);
  return mutationResult(updated, totals);
}

export async function deleteFoodLog(user: User, id: string) {
  const deleted = await db.transaction(async (tx) => {
    const row = await foodLogRepo.deleteLogForUser(user.id, id, tx);
    if (!row) throw new NotFoundError("Food log not found");
    await refreshDailySummary(user, row.localDate, tx);
    return row;
  });
  await invalidateFoodDashboardCache(user.id, deleted.localDate);
}

export async function recentFoods(user: User, limit = 20): Promise<FoodLogEntry[]> {
  const logs = await foodLogRepo.listRecentLogs(user.id, limit);
  return logs.map(toFoodLogEntry);
}

async function writeNutrition(
  foodItemId: string,
  payload: UpsertFoodPayload,
  tx: Parameters<typeof foodItemRepo.upsertNutrients>[1]
) {
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
    {
      id: null,
      measure: "serving",
      label: defaultLabel,
      grams: defaultGrams || null,
      isDefault: true,
    },
    { id: GRAMS_SERVING_ID, measure: "weight", label: "grams", grams: 1, isDefault: false },
  ];
  for (const serving of servings) {
    if (options.some((option) => option.id === serving.id || option.label === serving.label))
      continue;
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

type DailyTotals = Awaited<ReturnType<typeof dailyTotals>>;

function mutationResult(log: FoodLog, totals: DailyTotals) {
  return {
    entry: toFoodLogEntry(log),
    totals,
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

/** Exported for the R1-5 backfill script, which must re-run recompute through this exact
 * advisory-locked path (never a bespoke recompute) so it can't race a live writer. */
export async function refreshDailySummary(
  user: User,
  day: string,
  tx: Executor
): Promise<DailyTotals> {
  // Serialize same-day writers before reading totals so the absolute recompute
  // can't miss a concurrently-inserted row (see daily-summary.repository.lockForDay).
  await dailySummaryRepo.lockForDay(user.id, day, tx);
  const totals = await dailyTotals(user, day, tx);
  await dailySummaryRepo.upsertForDay(
    {
      userId: user.id,
      localDate: day,
      totalCalories: totals.calories,
      totalProteinG: String(totals.proteinG),
      totalCarbsG: String(totals.carbsG),
      totalFatG: String(totals.fatG),
      calorieTarget: user.manualDailyTargetKcal ?? user.dailyTargetKcal ?? DEFAULT_TARGET_CALORIES,
    },
    tx
  );
  return totals;
}

async function dailyTotals(user: User, day: string, tx: Executor = db) {
  const totals = await foodLogRepo.totalsForDay(user.id, day, tx);
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

/**
 * Resolves an explicit `servingId` to one of the item's real `food_servings`
 * rows. `null`/undefined (no explicit serving) and the GRAMS_SERVING_ID
 * sentinel both intentionally resolve to `null` here — neither is a DB row.
 * Anything else that doesn't match is a stale/invalid id: reject it rather
 * than silently falling back to the default reference amount (D2).
 */
function resolveNamedServing(
  servingId: string | null | undefined,
  servings: FoodServingRow[]
): FoodServingRow | null {
  if (!servingId || servingId === GRAMS_SERVING_ID) return null;
  const match = servings.find((candidate) => candidate.id === servingId);
  if (!match) {
    throw new ValidationError("Selected serving no longer exists for this food");
  }
  return match;
}

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

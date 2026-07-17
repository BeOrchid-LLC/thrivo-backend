import { db } from "../../db";
import type { Executor } from "../../db/tx";
import type {
  FoodItem,
  FoodLogEntry,
  FoodSearchPhase,
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
import type { FoodItemRow, FoodNutrientRow, FoodServingRow } from "../../db/schema";
import type { User } from "../repositories/user.repository";
import {
  fetchOpenFoodFactsProduct,
  type OpenFoodFactsProduct,
  type OpenFoodFactsSearchResult,
} from "../integrations/open-food-facts";
import { invalidateFoodDashboardCache } from "./dashboard-cache.service";
import { enforceBarcodeLookupLimit, searchExternalFoods } from "./food-external.service";

const DEFAULT_TARGET_CALORIES = 1800;
const DEFAULT_SEARCH_PAGE_SIZE = 10;

type SearchCursor = { phase: "local"; offset: number } | { phase: "external"; page: number };

function encodeSearchCursor(cursor: SearchCursor): string {
  return cursor.phase === "local" ? `local:${cursor.offset}` : `external:${cursor.page}`;
}

function decodeSearchCursor(raw: string | undefined): SearchCursor {
  if (!raw) return { phase: "local", offset: 0 };

  const match = /^(local|external):(\d+)$/.exec(raw);
  if (!match) throw new ValidationError("Invalid search cursor");

  const phase = match[1] as SearchCursor["phase"];
  const value = Number(match[2]);
  if (!Number.isFinite(value) || value < 0) throw new ValidationError("Invalid search cursor");

  if (phase === "local") return { phase: "local", offset: value };
  if (value < 1) throw new ValidationError("Invalid search cursor");
  return { phase: "external", page: value };
}

function offSearchHitToProduct(hit: OpenFoodFactsSearchResult): OpenFoodFactsProduct | null {
  if (!hit.barcode && !hit.externalId) return null;

  return {
    externalId: hit.externalId,
    barcode: hit.barcode,
    name: hit.name,
    brand: hit.brand,
    basis: hit.basis,
    servingLabel: hit.servingLabel,
    servingGrams: hit.servingGrams,
    nutrients: hit.nutrients,
  };
}

/**
 * Idempotent OFF → `food_items` materialize. Shared by barcode lookup and
 * catalog-first search fill so both paths write the same authoritative shape.
 * Concurrent inserts on the same barcode re-read the winner via the active
 * barcode unique index rather than failing the request.
 */
export async function upsertOffProduct(product: OpenFoodFactsProduct): Promise<FoodItemRow> {
  if (!product.barcode && !product.externalId) {
    throw new ValidationError("External food is missing a stable identity");
  }
  return db.transaction(async (tx) => {
    const existing = product.barcode
      ? await foodItemRepo.findActiveByBarcode(product.barcode, tx)
      : await foodItemRepo.findActiveByOriginRef("openfoodfacts", product.externalId!, tx);
    if (existing) return existing;

    try {
      const item = await foodItemRepo.insertItem(
        {
          tier: "authoritative",
          status: "active",
          origin: "openfoodfacts",
          originRef: product.externalId ?? product.barcode,
          barcode: product.barcode,
          name: product.name,
          brand: product.brand,
        },
        tx
      );
      await foodItemRepo.upsertNutrients(
        {
          foodItemId: item.id,
          basis: product.basis,
          servingLabel: product.servingLabel,
          // The reference amount is only ever servingGrams when the whole product
          // was normalized on that basis (ADR-0022/D1) — a per_100g product may
          // still carry a display-only servingGrams hint that isn't the divisor.
          servingG: product.basis === "per_serving" ? String(product.servingGrams) : null,
          kcal: String(product.nutrients.calories),
          proteinG: String(product.nutrients.proteinG),
          carbsG: String(product.nutrients.carbsG),
          fatG: String(product.nutrients.fatG),
          dataCompleteness: "0.7",
        },
        tx
      );
      if (product.servingGrams) {
        await foodItemRepo.insertServing(
          {
            foodItemId: item.id,
            label: product.servingLabel,
            grams: String(product.servingGrams),
            isDefault: true,
          },
          tx
        );
      }
      return item;
    } catch (err) {
      const raced = product.barcode
        ? await foodItemRepo.findActiveByBarcode(product.barcode, tx)
        : await foodItemRepo.findActiveByOriginRef("openfoodfacts", product.externalId!, tx);
      if (raced) return raced;
      throw err;
    }
  });
}

export async function lookupFood(user: User, barcode: string): Promise<FoodItem | null> {
  const cached = await foodItemRepo.findActiveByBarcode(barcode);
  if (cached && canSeeFood(user, cached)) return toFoodItem(cached.id, user.id);

  let upstream;
  try {
    await enforceBarcodeLookupLimit(user.id);
    upstream = await fetchOpenFoodFactsProduct(barcode);
  } catch (err) {
    if (err instanceof RateLimitedError) throw err;
    throw new UpstreamError("Could not look up barcode right now", err);
  }
  if (!upstream) return null;

  const created = await upsertOffProduct(upstream);
  return toFoodItem(created.id, user.id);
}

export async function searchFoods(
  user: User,
  query: string,
  limit = DEFAULT_SEARCH_PAGE_SIZE,
  cursorRaw?: string
): Promise<{
  items: FoodItem[];
  nextCursor: string | null;
  phase: FoodSearchPhase;
  cached: boolean;
}> {
  const pageSize = Math.min(Math.max(1, limit), DEFAULT_SEARCH_PAGE_SIZE);
  const cursor = decodeSearchCursor(cursorRaw);

  if (cursor.phase === "local") {
    const rows = await foodItemRepo.searchVisibleByText(user.id, query, pageSize, cursor.offset);
    const items = await toFoodItemsPreservingOrder(
      rows.map((row) => row.id),
      user.id
    );
    const nextCursor =
      rows.length === pageSize
        ? encodeSearchCursor({ phase: "local", offset: cursor.offset + pageSize })
        : encodeSearchCursor({ phase: "external", page: 1 });

    return { items, nextCursor, phase: "local", cached: false };
  }

  const { items: offHits, cached } = await searchExternalFoods(
    user.id,
    query,
    pageSize,
    cursor.page
  );
  const ids: string[] = [];
  for (const hit of offHits) {
    const product = offSearchHitToProduct(hit);
    if (!product) continue;
    const row = await upsertOffProduct(product);
    ids.push(row.id);
  }
  const items = await toFoodItemsPreservingOrder(ids, user.id);
  const nextCursor =
    offHits.length === pageSize
      ? encodeSearchCursor({ phase: "external", page: cursor.page + 1 })
      : null;

  return { items, nextCursor, phase: "external", cached };
}

export async function getFoodDetail(user: User, id: string): Promise<FoodItem> {
  const item = await foodItemRepo.findById(id);
  if (!item || !canSeeFood(user, item)) throw new NotFoundError("Food not found");
  const mapped = await toFoodItem(id, user.id);
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
  const mapped = await toFoodItem(item.id, user.id);
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
  const mapped = await toFoodItem(updated.id, user.id);
  if (!mapped) throw new NotFoundError("Food not found");
  return mapped;
}

/**
 * One joined/inArray round-trip regardless of favorite count (R5-1/I13),
 * replacing the old fan-out where every favorite fired 3 sequential queries.
 * Ordering is preserved from `listForUser` (most-used, then most-recent) —
 * applied here in JS, not left to the batch query's arbitrary row order.
 */
export async function listFavorites(user: User): Promise<FoodItem[]> {
  const favorites = await foodFavoriteRepo.listForUser(user.id);
  if (favorites.length === 0) return [];

  const ids = favorites.map((favorite) => favorite.foodItemId);
  const [rows, servings] = await Promise.all([
    foodItemRepo.findManyWithNutrients(ids),
    foodItemRepo.getServingsForItems(ids),
  ]);

  const rowById = new Map(rows.map((row) => [row.item.id, row]));
  const servingsByItem = new Map<string, FoodServingRow[]>();
  for (const serving of servings) {
    const list = servingsByItem.get(serving.foodItemId);
    if (list) list.push(serving);
    else servingsByItem.set(serving.foodItemId, [serving]);
  }

  const items: FoodItem[] = [];
  for (const favorite of favorites) {
    const row = rowById.get(favorite.foodItemId);
    if (!row) continue; // orphaned favorite (item since removed) — same skip as the old .filter(null)
    items.push(
      mapFoodItem(row.item, row.nutrient, servingsByItem.get(favorite.foodItemId) ?? [], true)
    );
  }
  return items;
}

/** Validates + fetches the item once, then reuses it as the mutation response (R5-1/I13). */
export async function addFavorite(user: User, foodItemId: string): Promise<FoodItem> {
  const item = await getFoodDetail(user, foodItemId);
  await foodFavoriteRepo.addFavorite({ userId: user.id, foodItemId, lastUsedAt: new Date() });
  return { ...item, isFavorite: true };
}

/** Returns the removed item so the client can patch its list in place instead of re-fetching (R5-1/I13). */
export async function removeFavorite(user: User, foodItemId: string): Promise<FoodItem | null> {
  const item = await toFoodItem(foodItemId, user.id, true);
  await foodFavoriteRepo.removeFavorite(user.id, foodItemId);
  return item ? { ...item, isFavorite: false } : null;
}

export async function logFood(user: User, payload: LogFoodPayload, idempotencyKey?: string | null) {
  if (payload.externalFood) {
    return logExternalFood(user, payload, idempotencyKey);
  }
  if (!payload.foodItemId) throw new ConflictError("Food item is required");
  return logCatalogFoodById(user, payload.foodItemId, payload, idempotencyKey);
}

async function logCatalogFoodById(
  user: User,
  foodItemId: string,
  payload: Pick<LogFoodPayload, "day" | "servings" | "servingId" | "servingUnit" | "consumedAt">,
  idempotencyKey?: string | null
) {
  const item = await foodItemRepo.findById(foodItemId);
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
  return mutationResult(user, log, totals);
}

async function logExternalFood(
  user: User,
  payload: LogFoodPayload,
  idempotencyKey?: string | null
) {
  const snapshot = payload.externalFood;
  if (!snapshot) throw new ConflictError("Food snapshot is required");
  if (!snapshot.servingGrams || snapshot.servingGrams <= 0) {
    throw new ValidationError("External food must include a positive servingGrams reference");
  }

  // Bridge for pre-0.16 clients: materialize a catalog row, then log by foodItemId.
  const foodItemId = await resolveExternalSnapshotToFoodItemId(user, snapshot);
  return logCatalogFoodById(
    user,
    foodItemId,
    {
      day: payload.day,
      servings: payload.servings,
      servingId: payload.servingId,
      servingUnit: payload.servingUnit ?? snapshot.servingLabel,
      consumedAt: payload.consumedAt,
    },
    idempotencyKey
  );
}

/**
 * Prefer an existing barcode catalog row / OFF upsert; otherwise create a
 * personal item from the client snapshot so the diary always gets a foodItemId.
 */
async function resolveExternalSnapshotToFoodItemId(
  user: User,
  snapshot: NonNullable<LogFoodPayload["externalFood"]>
): Promise<string> {
  if (snapshot.barcode) {
    const cached = await foodItemRepo.findActiveByBarcode(snapshot.barcode);
    if (cached) return cached.id;

    try {
      const upstream = await fetchOpenFoodFactsProduct(snapshot.barcode);
      if (upstream) return (await upsertOffProduct(upstream)).id;
    } catch {
      // Fall through to snapshot materialize when OFF is unavailable.
    }

    return (
      await upsertOffProduct({
        barcode: snapshot.barcode,
        name: snapshot.name,
        brand: snapshot.brand ?? null,
        basis: snapshot.servingGrams && snapshot.servingGrams > 0 ? "per_serving" : "per_100g",
        servingLabel: snapshot.servingLabel,
        servingGrams: snapshot.servingGrams ?? null,
        nutrients: snapshot.nutrients,
      })
    ).id;
  }

  const existingPersonal = await foodItemRepo.findPersonalByName(user.id, snapshot.name);
  if (existingPersonal) return existingPersonal.id;

  const created = await db.transaction(async (tx) => {
    const item = await foodItemRepo.insertItem(
      {
        tier: "personal",
        status: "active",
        origin: "personal",
        name: snapshot.name,
        brand: snapshot.brand ?? null,
        createdBy: user.id,
        ownerUserId: user.id,
      },
      tx
    );
    await foodItemRepo.upsertNutrients(
      {
        foodItemId: item.id,
        basis: "per_serving",
        servingLabel: snapshot.servingLabel,
        servingG: String(snapshot.servingGrams),
        kcal: String(snapshot.nutrients.calories),
        proteinG: String(snapshot.nutrients.proteinG),
        carbsG: String(snapshot.nutrients.carbsG),
        fatG: String(snapshot.nutrients.fatG),
        dataCompleteness: "0.5",
      },
      tx
    );
    if (snapshot.servingGrams) {
      await foodItemRepo.insertServing(
        {
          foodItemId: item.id,
          label: snapshot.servingLabel,
          grams: String(snapshot.servingGrams),
          isDefault: true,
        },
        tx
      );
    }
    return item;
  });
  return created.id;
}

export async function logEstimate(
  user: User,
  payload: LogEstimatePayload,
  idempotencyKey?: string | null
) {
  const consumedAt = payload.consumedAt ? new Date(payload.consumedAt) : new Date();
  const now = new Date();
  const { log, totals } = await db.transaction(async (tx) => {
    const item = await ensurePersonalEstimateItem(user, payload, tx);
    const log = await foodLogRepo.createLog(
      {
        userId: user.id,
        idempotencyKey: idempotencyKey ?? null,
        loggedAt: now,
        consumedAt,
        localDate: payload.day,
        source: "manual",
        foodItemId: item.id,
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
  return mutationResult(user, log, totals);
}

/**
 * Creates (or reuses) a personal catalog row for a describe-meal estimate so the
 * log gets a durable foodItemId and the item shows up in that user's local search.
 * Nutrients are stored per unit of `quantity` so re-logs scale cleanly.
 */
async function ensurePersonalEstimateItem(
  user: User,
  payload: LogEstimatePayload,
  tx: Executor
): Promise<FoodItemRow> {
  const existing = await foodItemRepo.findPersonalEstimateByName(user.id, payload.name, tx);
  if (existing) return existing;

  const quantity = payload.quantity || 1;
  const servingLabel = payload.servingUnit ?? payload.portionMeasure;
  const created = await foodItemRepo.insertItem(
    {
      tier: "personal",
      status: "active",
      origin: "personal",
      originRef: "estimate",
      name: payload.name,
      createdBy: user.id,
      ownerUserId: user.id,
    },
    tx
  );
  await foodItemRepo.upsertNutrients(
    {
      foodItemId: created.id,
      basis: "per_serving",
      servingLabel,
      servingG: String(payload.referenceGrams / quantity),
      kcal: String(payload.nutrients.calories / quantity),
      proteinG: String(payload.nutrients.proteinG / quantity),
      carbsG: String(payload.nutrients.carbsG / quantity),
      fatG: String(payload.nutrients.fatG / quantity),
      dataCompleteness: "0.4",
    },
    tx
  );
  return created;
}

export async function updateFoodLog(user: User, id: string, payload: UpdateLogPayload) {
  const existing = await foodLogRepo.findLogForUser(user.id, id);
  if (!existing) throw new NotFoundError("Food log not found");

  const nextServings = payload.servings ?? toNumber(existing.servingQty);
  const servingChanged = payload.servingId !== undefined;
  let nutrition = {
    kcal: Math.round(existing.kcal * (nextServings / (toNumber(existing.servingQty) || 1))),
    proteinG: toNumber(existing.proteinG) * (nextServings / (toNumber(existing.servingQty) || 1)),
    carbsG: toNumber(existing.carbsG) * (nextServings / (toNumber(existing.servingQty) || 1)),
    fatG: toNumber(existing.fatG) * (nextServings / (toNumber(existing.servingQty) || 1)),
  };
  let servingId = existing.servingId;
  let servingUnit = payload.servingUnit === undefined ? existing.servingUnit : payload.servingUnit;

  if (servingChanged) {
    if (!existing.foodItemId) {
      throw new ConflictError("Cannot change serving for a legacy food log without a food item");
    }
    const item = await foodItemRepo.findById(existing.foodItemId);
    if (!item || !canSeeFood(user, item)) throw new NotFoundError("Food not found");
    const nutrient = await foodItemRepo.getNutrients(item.id);
    if (!nutrient) throw new ConflictError("Food has no nutrition data");
    const servings = await foodItemRepo.getServings(item.id);
    const selectedServing = resolveNamedServing(payload.servingId, servings);
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
        quantity: nextServings,
        matchedServingGrams: selectedServing ? toNumber(selectedServing.grams) : null,
      },
      basis
    );
    const scaled = scaleNutrients(basis, quantityGrams);
    nutrition = scaled;
    servingId = selectedServing?.id ?? null;
    if (payload.servingUnit === undefined) {
      servingUnit =
        selectedServing?.label ??
        (payload.servingId === GRAMS_SERVING_ID ? "g" : nutrient.servingLabel);
    }
  }

  const patch = {
    servingQty: String(nextServings),
    servingId,
    servingUnit,
    consumedAt: payload.consumedAt ? new Date(payload.consumedAt) : existing.consumedAt,
    kcal: nutrition.kcal,
    proteinG: String(nutrition.proteinG),
    carbsG: String(nutrition.carbsG),
    fatG: String(nutrition.fatG),
    updatedAt: new Date(),
  };
  const { updated, totals } = await db.transaction(async (tx) => {
    const updated = await foodLogRepo.updateLogForUser(user.id, id, patch, tx);
    if (!updated) throw new NotFoundError("Food log not found");
    const totals = await refreshDailySummary(user, updated.localDate, tx);
    return { updated, totals };
  });
  await invalidateFoodDashboardCache(user.id, updated.localDate);
  return mutationResult(user, updated, totals);
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
  const favoriteIds = await favoriteIdsForLogs(user.id, logs);
  return logs.map((log) => toFoodLogEntry(log, favoriteIds));
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

async function toFoodItem(
  id: string,
  userId?: string,
  fallbackIsFavorite = false
): Promise<FoodItem | null> {
  const items = await toFoodItemsPreservingOrder([id], userId, fallbackIsFavorite);
  return items[0] ?? null;
}

/** Batch-map catalog ids to API FoodItems, preserving input order and skipping orphans. */
async function toFoodItemsPreservingOrder(
  ids: string[],
  userId?: string,
  fallbackIsFavorite = false
): Promise<FoodItem[]> {
  if (ids.length === 0) return [];

  const [rows, servings, favoriteIds] = await Promise.all([
    foodItemRepo.findManyWithNutrients(ids),
    foodItemRepo.getServingsForItems(ids),
    userId
      ? foodFavoriteRepo.listMatchingIdsForUser(userId, ids)
      : Promise.resolve(null as Set<string> | null),
  ]);

  const rowById = new Map(rows.map((row) => [row.item.id, row]));
  const servingsByItem = new Map<string, FoodServingRow[]>();
  for (const serving of servings) {
    const list = servingsByItem.get(serving.foodItemId);
    if (list) list.push(serving);
    else servingsByItem.set(serving.foodItemId, [serving]);
  }

  const items: FoodItem[] = [];
  for (const id of ids) {
    const row = rowById.get(id);
    if (!row) continue;
    items.push(
      mapFoodItem(
        row.item,
        row.nutrient,
        servingsByItem.get(id) ?? [],
        favoriteIds?.has(id) ?? fallbackIsFavorite
      )
    );
  }
  return items;
}

function mapFoodItem(
  item: FoodItemRow,
  nutrient: FoodNutrientRow,
  servings: FoodServingRow[],
  isFavorite = false
): FoodItem {
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
    isEstimated: item.originRef === "estimate",
    isFavorite,
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

async function mutationResult(user: User, log: FoodLog, totals: DailyTotals) {
  const favoriteIds = await favoriteIdsForLogs(user.id, [log]);
  return {
    entry: toFoodLogEntry(log, favoriteIds),
    totals,
  };
}

function toFoodLogEntry(log: FoodLog, favoriteIds: ReadonlySet<string> = new Set()): FoodLogEntry {
  return {
    id: log.id,
    foodItemId: log.foodItemId,
    servingId:
      log.servingId ??
      (log.servingUnit?.trim().toLowerCase() === "grams" ? GRAMS_SERVING_ID : null),
    name: log.name,
    day: log.localDate,
    servings: toNumber(log.servingQty) || 1,
    servingUnit: log.servingUnit,
    source: log.source,
    barcode: log.barcode,
    isEstimated: log.source === "manual",
    isFavorite: log.foodItemId ? favoriteIds.has(log.foodItemId) : false,
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

async function favoriteIdsForLogs(userId: string, logs: readonly FoodLog[]): Promise<Set<string>> {
  return foodFavoriteRepo.listMatchingIdsForUser(
    userId,
    logs.map((log) => log.foodItemId).filter((id): id is string => Boolean(id))
  );
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

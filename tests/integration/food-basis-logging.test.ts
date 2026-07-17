import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";
import { GRAMS_SERVING_ID } from "../../src/lib/nutrition";
import { foodItemRepo } from "../../src/repositories";
import { logFood, updateFoodLog } from "../../src/services/food.service";
import type { LogFoodPayload } from "../../contracts/src/foods";

// Integration suite — real test Postgres, gated by RUN_DB_TESTS=1.
const run = process.env.RUN_DB_TESTS === "1";

const DAY = "2026-06-15";

async function makePerServingItem() {
  const item = await foodItemRepo.insertItem({
    tier: "authoritative",
    origin: "openfoodfacts",
    originRef: "0000000000001",
    barcode: "0000000000001",
    name: "Protein Bar",
  });
  await foodItemRepo.upsertNutrients({
    foodItemId: item.id,
    basis: "per_serving",
    servingLabel: "1 bar (40g)",
    servingG: "40",
    kcal: "180",
    proteinG: "10",
    carbsG: "20",
    fatG: "5",
  });
  return item;
}

function logPayload(overrides: Partial<LogFoodPayload> = {}): LogFoodPayload {
  return { day: DAY, servings: 1, ...overrides } as LogFoodPayload;
}

describe.skipIf(!run)("integration: food basis logging (R1 / I1, I2)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeDb();
  });

  it("I1 regression: logging 150g of a per-serving item (servingG 40, 180 kcal) records 675 kcal", async () => {
    const user = await makeUser();
    const item = await makePerServingItem();

    const result = await logFood(
      user,
      logPayload({ foodItemId: item.id, servingId: GRAMS_SERVING_ID, servings: 150 })
    );

    expect(result.entry.nutrients.calories).toBe(675);
    expect(result.entry.servingUnit).toBe("g");
  });

  it("resolves a named serving by grams, independent of the item's own basis", async () => {
    const user = await makeUser();
    const item = await makePerServingItem();
    const cup = await foodItemRepo.insertServing({
      foodItemId: item.id,
      label: "1 cup",
      grams: "240",
      isDefault: false,
    });

    const result = await logFood(
      user,
      logPayload({ foodItemId: item.id, servingId: cup.id, servings: 1 })
    );

    // 240g / 40g reference * 180 kcal = 1080
    expect(result.entry.nutrients.calories).toBe(1080);
    expect(result.entry.servingUnit).toBe("1 cup");
  });

  it("preserves the existing default-serving behavior when no servingId is sent", async () => {
    const user = await makeUser();
    const item = await makePerServingItem();

    const result = await logFood(user, logPayload({ foodItemId: item.id, servings: 2 }));

    expect(result.entry.nutrients.calories).toBe(360);
  });

  it("rejects a stale/unknown servingId instead of silently defaulting to 1x", async () => {
    const user = await makeUser();
    const item = await makePerServingItem();

    await expect(
      logFood(user, logPayload({ foodItemId: item.id, servingId: crypto.randomUUID() }))
    ).rejects.toThrow(/serving/i);
  });

  it("recomputes snapshots for serving changes and preserves quantity-only scaling", async () => {
    const user = await makeUser();
    const item = await makePerServingItem();
    const cup = await foodItemRepo.insertServing({
      foodItemId: item.id,
      label: "1 cup",
      grams: "240",
      isDefault: false,
    });
    const created = await logFood(user, logPayload({ foodItemId: item.id, servings: 1 }));
    const named = await updateFoodLog(user, created.entry.id, { servingId: cup.id, servings: 1 });
    expect(named.entry.nutrients.calories).toBe(1080);
    expect(named.entry.servingId).toBe(cup.id);
    const quantity = await updateFoodLog(user, created.entry.id, { servings: 2 });
    expect(quantity.entry.nutrients.calories).toBe(2160);
    const grams = await updateFoodLog(user, created.entry.id, {
      servingId: GRAMS_SERVING_ID,
      servingUnit: "g",
      servings: 150,
    });
    expect(grams.entry.nutrients.calories).toBe(675);
    expect(grams.entry.servingUnit).toBe("g");
  });
  it("DB check constraint rejects a per_serving row with no serving_g", async () => {
    const item = await foodItemRepo.insertItem({
      tier: "authoritative",
      origin: "openfoodfacts",
      name: "Broken Item",
    });

    await expect(
      foodItemRepo.upsertNutrients({
        foodItemId: item.id,
        basis: "per_serving",
        servingG: null,
        kcal: "100",
        proteinG: "1",
        carbsG: "1",
        fatG: "1",
      })
    ).rejects.toThrow();
  });
});

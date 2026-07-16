import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import { foodItemRepo } from "../../src/repositories";
import { upsertOffProduct } from "../../src/services/food.service";
import type { OpenFoodFactsProduct } from "../../src/integrations/open-food-facts";

// Integration suite — real test Postgres, gated by RUN_DB_TESTS=1.
const run = process.env.RUN_DB_TESTS === "1";

const sampleProduct = (barcode = "3017620422003"): OpenFoodFactsProduct => ({
  barcode,
  name: "Nutella",
  brand: "Ferrero",
  basis: "per_100g",
  servingLabel: "15g",
  servingGrams: 15,
  nutrients: { calories: 539, proteinG: 6.3, carbsG: 57.5, fatG: 30.9 },
});

describe.skipIf(!run)("integration: upsertOffProduct (catalog materialize)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeDb();
  });

  it("inserts an authoritative OFF item with nutrients and a default serving", async () => {
    const product = sampleProduct();
    const created = await upsertOffProduct(product);

    expect(created.barcode).toBe(product.barcode);
    expect(created.tier).toBe("authoritative");
    expect(created.origin).toBe("openfoodfacts");
    expect(created.originRef).toBe(product.barcode);

    const nutrient = await foodItemRepo.getNutrients(created.id);
    expect(nutrient?.basis).toBe("per_100g");
    expect(nutrient?.kcal).toBe("539");

    const servings = await foodItemRepo.getServings(created.id);
    expect(servings).toHaveLength(1);
    expect(servings[0]?.label).toBe("15g");
    expect(servings[0]?.grams).toBe("15");
  });

  it("returns the same id on a second upsert for the same barcode", async () => {
    const product = sampleProduct("0000000000999");
    const first = await upsertOffProduct(product);
    const second = await upsertOffProduct({ ...product, name: "Nutella (renamed upstream)" });

    expect(second.id).toBe(first.id);
    // Stale nutrients are intentional for v1 — do not refresh on every hit.
    const nutrient = await foodItemRepo.getNutrients(first.id);
    expect(nutrient?.kcal).toBe("539");
    const row = await foodItemRepo.findById(first.id);
    expect(row?.name).toBe("Nutella");
  });
});

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";
import { foodItemRepo } from "../../src/repositories";
import { logFood } from "../../src/services/food.service";

const run = process.env.RUN_DB_TESTS === "1";

const { fetchOpenFoodFactsProduct } = vi.hoisted(() => ({
  fetchOpenFoodFactsProduct: vi.fn(),
}));

vi.mock("../../src/integrations/open-food-facts", async () => {
  const actual = await vi.importActual<typeof import("../../src/integrations/open-food-facts")>(
    "../../src/integrations/open-food-facts"
  );
  return {
    ...actual,
    fetchOpenFoodFactsProduct,
  };
});

describe.skipIf(!run)("integration: externalFood upsert-then-log bridge", () => {
  beforeEach(async () => {
    await resetDb();
    fetchOpenFoodFactsProduct.mockReset();
  });
  afterAll(async () => {
    await closeDb();
  });

  it("materializes a barcoded external snapshot into food_items and logs with that id", async () => {
    const user = await makeUser();
    fetchOpenFoodFactsProduct.mockResolvedValueOnce({
      barcode: "3017620422003",
      name: "Nutella",
      brand: "Ferrero",
      basis: "per_100g",
      servingLabel: "15g",
      servingGrams: 15,
      nutrients: { calories: 539, proteinG: 6.3, carbsG: 57.5, fatG: 30.9 },
    });

    const result = await logFood(
      user,
      {
        day: "2026-07-16",
        servings: 1,
        externalFood: {
          externalId: "off:3017620422003",
          name: "Nutella",
          brand: "Ferrero",
          barcode: "3017620422003",
          servingLabel: "15g",
          servingGrams: 15,
          nutrients: { calories: 80, proteinG: 1, carbsG: 8, fatG: 5 },
          source: "openfoodfacts",
        },
      },
      "ext-1"
    );

    expect(result.entry.foodItemId).toBeTruthy();
    expect(result.entry.name).toBe("Nutella");
    const cached = await foodItemRepo.findActiveByBarcode("3017620422003");
    expect(cached?.id).toBe(result.entry.foodItemId);
  });

  it("creates a personal item when the external snapshot has no barcode", async () => {
    const user = await makeUser();
    const result = await logFood(
      user,
      {
        day: "2026-07-16",
        servings: 2,
        externalFood: {
          externalId: "off:no-code",
          name: "Market rice bowl",
          brand: null,
          barcode: null,
          servingLabel: "bowl",
          servingGrams: null,
          nutrients: { calories: 450, proteinG: 12, carbsG: 70, fatG: 10 },
          source: "openfoodfacts",
        },
      },
      "ext-2"
    );

    expect(result.entry.foodItemId).toBeTruthy();
    const item = await foodItemRepo.findById(result.entry.foodItemId!);
    expect(item?.tier).toBe("personal");
    expect(item?.ownerUserId).toBe(user.id);
    expect(fetchOpenFoodFactsProduct).not.toHaveBeenCalled();
  });
});

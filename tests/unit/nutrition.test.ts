import { describe, expect, it } from "vitest";
import {
  GRAMS_SERVING_ID,
  assertSupportedBasis,
  nutrientMultiplier,
  resolveQuantityGrams,
  scaleNutrients,
  type NutritionBasis,
} from "../../src/lib/nutrition";

// I1 fixture: a per-serving item, one serving = 40 g = 180 kcal.
const perServingItem: NutritionBasis = {
  basis: "per_serving",
  servingG: 40,
  kcal: 180,
  proteinG: 10,
  carbsG: 20,
  fatG: 5,
};

const per100gItem: NutritionBasis = {
  basis: "per_100g",
  servingG: null,
  kcal: 250,
  proteinG: 8,
  carbsG: 30,
  fatG: 9,
};

describe("resolveQuantityGrams", () => {
  it("regression: 150 g of a per-serving item (I1) resolves to 150 g, not 150x the serving", () => {
    const grams = resolveQuantityGrams(
      { servingId: GRAMS_SERVING_ID, quantity: 150 },
      perServingItem
    );
    expect(grams).toBe(150);
    expect(scaleNutrients(perServingItem, grams).kcal).toBe(675);
  });

  it("resolves a named serving by multiplying the entered count by its gram weight", () => {
    const grams = resolveQuantityGrams(
      { servingId: "serving-uuid", quantity: 2, matchedServingGrams: 30 },
      perServingItem
    );
    expect(grams).toBe(60);
  });

  it("defaults to the item's own reference amount when no serving is selected (per_serving)", () => {
    const grams = resolveQuantityGrams({ servingId: null, quantity: 2 }, perServingItem);
    expect(grams).toBe(80); // 2 x the 40g reference serving
    expect(scaleNutrients(perServingItem, grams).kcal).toBe(360);
  });

  it("defaults to a 100 g reference amount when no serving is selected (per_100g)", () => {
    const grams = resolveQuantityGrams({ servingId: null, quantity: 2 }, per100gItem);
    expect(grams).toBe(200); // 2 x 100g units — preserves existing per_100g convention
    expect(scaleNutrients(per100gItem, grams).kcal).toBe(500);
  });

  it("rejects a zero/negative quantity", () => {
    expect(() => resolveQuantityGrams({ servingId: null, quantity: 0 }, perServingItem)).toThrow(
      /positive/i
    );
  });

  it("rejects a named serving whose gram weight is missing or zero — never falls through to a silent 1x", () => {
    expect(() =>
      resolveQuantityGrams(
        { servingId: "serving-uuid", quantity: 2, matchedServingGrams: 0 },
        perServingItem
      )
    ).toThrow(/gram weight/i);
    expect(() =>
      resolveQuantityGrams({ servingId: "serving-uuid", quantity: 2 }, perServingItem)
    ).toThrow(/gram weight/i);
  });

  it("rejects a per_serving item with servingG <= 0 instead of dividing by zero", () => {
    const broken: NutritionBasis = { ...perServingItem, servingG: 0 };
    expect(() => resolveQuantityGrams({ servingId: null, quantity: 1 }, broken)).toThrow(
      /reference serving size/i
    );
    expect(() => nutrientMultiplier(100, broken)).toThrow(/reference serving size/i);
  });
});

describe("scaleNutrients", () => {
  it("scales all macros by the same factor and rounds kcal to an int, macros to 1dp", () => {
    const result = scaleNutrients(perServingItem, 60); // 1.5x the 40g reference
    expect(result).toEqual({ kcal: 270, proteinG: 15, carbsG: 30, fatG: 7.5 });
  });
});

describe("assertSupportedBasis", () => {
  it("passes through the two supported bases", () => {
    expect(assertSupportedBasis("per_100g")).toBe("per_100g");
    expect(assertSupportedBasis("per_serving")).toBe("per_serving");
  });

  it("rejects an unsupported basis (e.g. the unused per_100ml enum value)", () => {
    expect(() => assertSupportedBasis("per_100ml")).toThrow(/unsupported/i);
  });
});

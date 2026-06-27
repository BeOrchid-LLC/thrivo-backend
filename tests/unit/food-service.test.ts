import { describe, expect, it } from "vitest";
import { estimateFood } from "../../src/services/food.service";

describe("food.service", () => {
  it("returns visible estimated nutrition for describe-meal input", () => {
    const estimate = estimateFood({
      name: "Chicken breast, grilled",
      ingredients: "Chicken breast, pepper",
      cookingMethod: "grilled",
      portionMeasure: "weight",
      quantity: 150,
    });

    expect(estimate.isEstimated).toBe(true);
    expect(estimate.servingUnit).toBe("weight");
    expect(estimate.nutrients.calories).toBeGreaterThan(0);
    expect(estimate.nutrients.proteinG).toBeGreaterThan(0);
  });
});

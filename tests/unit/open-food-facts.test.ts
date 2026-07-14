import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", fetchMock);

import {
  fetchOpenFoodFactsProduct,
  searchOpenFoodFactsProducts,
  OFF_USER_AGENT,
} from "../../src/integrations/open-food-facts";

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500) {
  return { ok, status, json: async () => body };
}

describe("open food facts integration", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("sends a descriptive User-Agent header on barcode lookup", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: "123", errors: [], product: { code: "123", product_name: "Test" } })
    );
    await fetchOpenFoodFactsProduct("123");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["User-Agent"]).toBe(OFF_USER_AGENT);
  });

  it("returns the product on the real v3 shape (no top-level status field)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        code: "3017620422003",
        errors: [],
        product: {
          code: "3017620422003",
          product_name: "Nutella",
          serving_quantity: 40,
          serving_size: "1 serving (40g)",
          nutriments: {
            "energy-kcal_serving": 180,
            proteins_serving: 10,
            carbohydrates_serving: 20,
            fat_serving: 5,
          },
        },
      })
    );
    const product = await fetchOpenFoodFactsProduct("3017620422003");
    expect(product).not.toBeNull();
    expect(product?.name).toBe("Nutella");
  });

  it("returns null (not a throw) when OFF responds 404 for an unknown barcode", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: "0", errors: [{}] }, false, 404));
    const product = await fetchOpenFoodFactsProduct("00000000000");
    expect(product).toBeNull();
  });

  it("sends a descriptive User-Agent header on search", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ products: [] }));
    await searchOpenFoodFactsProducts("chicken", 20);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["User-Agent"]).toBe(OFF_USER_AGENT);
  });

  it("returns an empty array (not throwing) when OFF has no matches", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ products: [] }));
    const results = await searchOpenFoodFactsProducts("zzzznonexistent", 20);
    expect(results).toEqual([]);
  });

  it("dedupes products by code and filters entries missing a name", async () => {
    const nutriments = {
      "energy-kcal_100g": 450,
      proteins_100g: 25,
      carbohydrates_100g: 50,
      fat_100g: 12.5,
    };
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        products: [
          { code: "1", product_name: "A", nutriments },
          { code: "1", product_name: "A dup", nutriments },
          { code: "2", nutriments }, // no product_name -> filtered
        ],
      })
    );
    const results = await searchOpenFoodFactsProducts("a", 20);
    expect(results).toHaveLength(1);
    expect(results[0].externalId).toBe("off:1");
  });
});

describe("normalizeProduct basis selection (I2 / ADR-0022 D1)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("picks per_serving only when the full *_serving set AND a serving_quantity are present", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        product: {
          code: "1",
          product_name: "Protein Bar",
          serving_size: "1 bar (40g)",
          serving_quantity: 40,
          nutriments: {
            "energy-kcal_serving": 180,
            proteins_serving: 10,
            carbohydrates_serving: 20,
            fat_serving: 5,
            "energy-kcal_100g": 450,
            proteins_100g: 25,
            carbohydrates_100g: 50,
            fat_100g: 12.5,
          },
        },
      })
    );
    const product = await fetchOpenFoodFactsProduct("1");
    expect(product).toMatchObject({
      basis: "per_serving",
      servingGrams: 40,
      nutrients: { calories: 180, proteinG: 10, carbsG: 20, fatG: 5 },
    });
  });

  it("falls back to per_100g when the *_serving set is only partially present", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        product: {
          code: "2",
          product_name: "Mixed Product",
          serving_quantity: 40,
          nutriments: {
            "energy-kcal_serving": 180, // partial: no proteins/carbs/fat_serving
            "energy-kcal_100g": 450,
            proteins_100g: 25,
            carbohydrates_100g: 50,
            fat_100g: 12.5,
          },
        },
      })
    );
    const product = await fetchOpenFoodFactsProduct("2");
    expect(product?.basis).toBe("per_100g");
    // Regression: the old per-nutrient fallback would source calories from
    // energy-kcal_serving (180) while protein/carbs/fat came from *_100g,
    // mixing bases within one row. Every nutrient here must be the _100g value.
    expect(product?.nutrients).toEqual({
      calories: 450,
      proteinG: 25,
      carbsG: 50,
      fatG: 12.5,
    });
  });

  it("treats a missing serving_quantity as disqualifying the per_serving basis", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        product: {
          code: "3",
          product_name: "No Serving Quantity",
          nutriments: {
            "energy-kcal_serving": 180,
            proteins_serving: 10,
            carbohydrates_serving: 20,
            fat_serving: 5,
            "energy-kcal_100g": 450,
            proteins_100g: 25,
            carbohydrates_100g: 50,
            fat_100g: 12.5,
          },
        },
      })
    );
    const product = await fetchOpenFoodFactsProduct("3");
    expect(product?.basis).toBe("per_100g");
  });

  it("rejects a product with neither a full *_serving nor a full *_100g set", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        product: {
          code: "4",
          product_name: "Incomplete Product",
          nutriments: { "energy-kcal_100g": 450 }, // missing protein/carbs/fat
        },
      })
    );
    const product = await fetchOpenFoodFactsProduct("4");
    expect(product).toBeNull();
  });
});

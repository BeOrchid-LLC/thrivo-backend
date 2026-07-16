import { beforeEach, describe, expect, it, vi } from "vitest";

const redis = vi.hoisted(() => {
  const store = new Map<string, string>();
  const sorted = new Map<string, number>();
  const counters = new Map<string, number>();
  return {
    instance: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
        return "OK";
      }),
      zadd: vi.fn(async (_key: string, score: number, member: string) => {
        sorted.set(member, score);
        return 1;
      }),
      zcard: vi.fn(async () => sorted.size),
      zrange: vi.fn(async (_key: string, start: number, stop: number) =>
        [...sorted.entries()]
          .sort((a, b) => a[1] - b[1])
          .slice(start, stop + 1)
          .map(([member]) => member)
      ),
      zrem: vi.fn(async (_key: string, ...members: string[]) => {
        for (const member of members) sorted.delete(member);
        return members.length;
      }),
      del: vi.fn(async (...keys: string[]) => {
        for (const key of keys) store.delete(key);
        return keys.length;
      }),
      incr: vi.fn(async (key: string) => {
        const n = (counters.get(key) ?? 0) + 1;
        counters.set(key, n);
        return n;
      }),
      expire: vi.fn(async () => 1),
    },
    reset: () => {
      store.clear();
      sorted.clear();
      counters.clear();
    },
  };
});

vi.mock("../../src/lib/redis", () => ({ getRedis: () => redis.instance }));

const { searchOpenFoodFactsProducts } = vi.hoisted(() => ({
  searchOpenFoodFactsProducts: vi.fn(),
}));
vi.mock("../../src/integrations/open-food-facts", () => ({ searchOpenFoodFactsProducts }));

import {
  enforceBarcodeLookupLimit,
  searchExternalFoods,
} from "../../src/services/food-external.service";

const result = {
  externalId: "off:1234567890123",
  name: "Greek yoghurt",
  brand: "Acme",
  barcode: "1234567890123",
  basis: "per_100g" as const,
  servingLabel: "100g",
  servingGrams: 100,
  nutrients: { calories: 90, proteinG: 9, carbsG: 4, fatG: 3 },
  source: "openfoodfacts" as const,
};

describe("food external search service", () => {
  beforeEach(() => {
    redis.reset();
    vi.clearAllMocks();
    searchOpenFoodFactsProducts.mockResolvedValue([result]);
  });

  it("calls Open Food Facts on cache miss and reuses cached normalized queries", async () => {
    const first = await searchExternalFoods("u1", " Greek   Yoghurt ", 20);
    const repeat = await searchExternalFoods("u1", "greek yoghurt", 20);

    expect(first).toEqual({ items: [result], cached: false });
    expect(repeat).toEqual({ items: [result], cached: true });
    expect(searchOpenFoodFactsProducts).toHaveBeenCalledTimes(1);
    expect(searchOpenFoodFactsProducts).toHaveBeenCalledWith("greek yoghurt", 20, 1);
  });

  it("passes the requested OFF page through on cache miss", async () => {
    await searchExternalFoods("u1", "oats", 10, 3);
    expect(searchOpenFoodFactsProducts).toHaveBeenCalledWith("oats", 10, 3);
  });

  it("rate-limits uncached upstream searches per user", async () => {
    redis.instance.incr.mockResolvedValueOnce(121);

    await expect(searchExternalFoods("u1", "new food", 20)).rejects.toThrow(
      "Food search limit reached"
    );
    expect(searchOpenFoodFactsProducts).not.toHaveBeenCalled();
  });

  it("rate-limits barcode lookup misses per user", async () => {
    redis.instance.incr.mockResolvedValueOnce(121);

    await expect(enforceBarcodeLookupLimit("u1")).rejects.toThrow("Barcode lookup limit reached");
  });

  it("fails open (allows the request) when Redis is unreachable during rate limiting", async () => {
    redis.instance.incr.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));

    await expect(enforceBarcodeLookupLimit("u1")).resolves.toBeUndefined();
  });

  it("does not cache empty search results, so a repeat search retries upstream", async () => {
    searchOpenFoodFactsProducts.mockResolvedValueOnce([]);

    const first = await searchExternalFoods("u1", "nonexistent food xyz", 20);
    expect(first).toEqual({ items: [], cached: false });

    searchOpenFoodFactsProducts.mockResolvedValueOnce([result]);
    const repeat = await searchExternalFoods("u1", "nonexistent food xyz", 20);

    expect(repeat).toEqual({ items: [result], cached: false });
    expect(searchOpenFoodFactsProducts).toHaveBeenCalledTimes(2);
  });
});

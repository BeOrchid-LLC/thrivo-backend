import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory Redis so cache-aside + the rate-limit counter behave like the real thing.
const redis = vi.hoisted(() => {
  const store = new Map<string, string>();
  const counters = new Map<string, number>();
  return {
    instance: {
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => {
        store.set(k, v);
        return "OK";
      }),
      incr: vi.fn(async (k: string) => {
        const n = (counters.get(k) ?? 0) + 1;
        counters.set(k, n);
        return n;
      }),
      expire: vi.fn(async () => 1),
    },
    reset: () => {
      store.clear();
      counters.clear();
    },
  };
});
vi.mock("../../src/lib/redis", () => ({ getRedis: () => redis.instance }));

const { estimateNutritionViaModel } = vi.hoisted(() => ({ estimateNutritionViaModel: vi.fn() }));
vi.mock("../../src/integrations/anthropic/estimate", () => ({ estimateNutritionViaModel }));

import { estimateNutrition } from "../../src/services/estimate.service";

const payload = { name: "Egusi soup", portionMeasure: "serving" as const, quantity: 1 };
const nutrients = { calories: 300, proteinG: 12, carbsG: 20, fatG: 18 };

describe("estimateNutrition service", () => {
  beforeEach(() => {
    redis.reset();
    vi.clearAllMocks();
    estimateNutritionViaModel.mockResolvedValue(nutrients);
  });

  it("caches by normalized description — a repeat reuses one model call", async () => {
    const first = await estimateNutrition("u1", payload);
    const repeat = await estimateNutrition("u1", payload);
    expect(first).toEqual(nutrients);
    expect(repeat).toEqual(nutrients);
    expect(estimateNutritionViaModel).toHaveBeenCalledTimes(1);
  });

  it("rate-limits real model calls per user", async () => {
    for (let i = 0; i < 30; i++) {
      await estimateNutrition("u1", { ...payload, name: `food-${i}` });
    }
    await expect(estimateNutrition("u1", { ...payload, name: "food-30" })).rejects.toThrow();
    expect(estimateNutritionViaModel).toHaveBeenCalledTimes(30);
  });

  it("fails closed on cache miss when Redis cannot enforce the spend limit", async () => {
    redis.instance.get.mockResolvedValueOnce(null);
    redis.instance.incr.mockRejectedValueOnce(new Error("redis down"));

    await expect(estimateNutrition("u1", { ...payload, name: "uncached" })).rejects.toThrow(
      "redis down"
    );
    expect(estimateNutritionViaModel).not.toHaveBeenCalled();
  });
});

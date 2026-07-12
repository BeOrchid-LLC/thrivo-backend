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
import type { User } from "../../src/repositories/user.repository";

const payload = { name: "Egusi soup", portionMeasure: "serving" as const, quantity: 1 };
const nutrients = { calories: 300, proteinG: 12, carbsG: 20, fatG: 18 };

const freeUser = { id: "u1", tier: "free" } as User;
const premiumUser = { id: "u2", tier: "premium" } as User;

describe("estimateNutrition service", () => {
  beforeEach(() => {
    redis.reset();
    vi.clearAllMocks();
    estimateNutritionViaModel.mockResolvedValue(nutrients);
  });

  it("caches by normalized description — a repeat reuses one model call", async () => {
    const first = await estimateNutrition(freeUser, payload);
    const repeat = await estimateNutrition(freeUser, payload);
    expect(first).toEqual(nutrients);
    expect(repeat).toEqual(nutrients);
    expect(estimateNutritionViaModel).toHaveBeenCalledTimes(1);
  });

  it("caps free users at the tighter free-tier limit, not the premium one", async () => {
    for (let i = 0; i < 5; i++) {
      await estimateNutrition(freeUser, { ...payload, name: `food-${i}` });
    }
    await expect(estimateNutrition(freeUser, { ...payload, name: "food-5" })).rejects.toThrow();
    expect(estimateNutritionViaModel).toHaveBeenCalledTimes(5);
  });

  it("gives premium users the full rate limit", async () => {
    for (let i = 0; i < 30; i++) {
      await estimateNutrition(premiumUser, { ...payload, name: `food-${i}` });
    }
    await expect(estimateNutrition(premiumUser, { ...payload, name: "food-30" })).rejects.toThrow();
    expect(estimateNutritionViaModel).toHaveBeenCalledTimes(30);
  });

  it("fails closed on cache miss when Redis cannot enforce the spend limit", async () => {
    redis.instance.get.mockResolvedValueOnce(null);
    redis.instance.incr.mockRejectedValueOnce(new Error("redis down"));

    await expect(estimateNutrition(freeUser, { ...payload, name: "uncached" })).rejects.toThrow(
      "redis down"
    );
    expect(estimateNutritionViaModel).not.toHaveBeenCalled();
  });
});

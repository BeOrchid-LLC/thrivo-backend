import { afterEach, describe, expect, it, vi } from "vitest";

const { getRedis } = vi.hoisted(() => ({ getRedis: vi.fn() }));
vi.mock("../../src/lib/redis", () => ({ getRedis }));

import { cacheAside } from "../../src/lib/cache";

function fakeRedis() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
      return "OK";
    }),
  };
}

describe("cacheAside", () => {
  afterEach(() => vi.clearAllMocks());

  it("runs the loader on a miss, then serves the cached value on a hit", async () => {
    getRedis.mockReturnValue(fakeRedis());
    const loader = vi.fn(async () => ({ n: 1 }));

    const first = await cacheAside("k", 60, loader);
    const second = await cacheAside("k", 60, loader);

    expect(first).toEqual({ n: 1 });
    expect(second).toEqual({ n: 1 });
    expect(loader).toHaveBeenCalledTimes(1); // second call hit the cache
  });

  it("falls through to the loader when Redis throws (degrades, never fails)", async () => {
    getRedis.mockReturnValue({
      get: vi.fn(async () => {
        throw new Error("redis down");
      }),
      set: vi.fn(async () => {
        throw new Error("redis down");
      }),
    });
    const loader = vi.fn(async () => "fresh");

    const result = await cacheAside("k", 60, loader);

    expect(result).toBe("fresh");
    expect(loader).toHaveBeenCalledTimes(1);
  });
});

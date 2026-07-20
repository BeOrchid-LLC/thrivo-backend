import { afterEach, describe, expect, it, vi } from "vitest";

const { getRedis } = vi.hoisted(() => ({ getRedis: vi.fn() }));
vi.mock("../../src/lib/redis", () => ({ getRedis }));

import {
  getAdminSnapshot,
  setAdminSnapshot,
  invalidateAdminSnapshot,
  type AdminSnapshot,
} from "../../src/admin/snapshot.service";

const snapshot: AdminSnapshot = {
  id: "a1",
  email: "ops@thrivo.fit",
  name: "Ops",
  role: "admin",
  status: "active",
};

function fakeRedis(overrides: Record<string, unknown> = {}) {
  return {
    get: vi.fn(async () => null),
    set: vi.fn(async () => "OK"),
    del: vi.fn(async () => 1),
    ...overrides,
  };
}

describe("getAdminSnapshot", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns null when Redis has no entry", async () => {
    getRedis.mockReturnValue(fakeRedis({ get: vi.fn(async () => null) }));
    const result = await getAdminSnapshot("ops@thrivo.fit");
    expect(result).toBeNull();
  });

  it("returns parsed snapshot on cache hit", async () => {
    getRedis.mockReturnValue(fakeRedis({ get: vi.fn(async () => JSON.stringify(snapshot)) }));
    const result = await getAdminSnapshot("ops@thrivo.fit");
    expect(result).toEqual(snapshot);
  });

  it("normalises the email key to lowercase", async () => {
    const redis = fakeRedis({ get: vi.fn(async () => null) });
    getRedis.mockReturnValue(redis);
    await getAdminSnapshot("OPS@THRIVO.FIT");
    expect(redis.get).toHaveBeenCalledWith("admin:snapshot:ops@thrivo.fit");
  });

  it("returns null (does not throw) when Redis throws", async () => {
    getRedis.mockReturnValue(
      fakeRedis({
        get: vi.fn(async () => {
          throw new Error("redis down");
        }),
      })
    );
    const result = await getAdminSnapshot("ops@thrivo.fit");
    expect(result).toBeNull();
  });
});

describe("setAdminSnapshot", () => {
  afterEach(() => vi.clearAllMocks());

  it("writes the snapshot JSON with a TTL", async () => {
    const redis = fakeRedis();
    getRedis.mockReturnValue(redis);
    await setAdminSnapshot(snapshot);
    expect(redis.set).toHaveBeenCalledWith(
      "admin:snapshot:ops@thrivo.fit",
      JSON.stringify(snapshot),
      "EX",
      expect.any(Number)
    );
  });

  it("does not throw when Redis throws", async () => {
    getRedis.mockReturnValue(
      fakeRedis({
        set: vi.fn(async () => {
          throw new Error("redis down");
        }),
      })
    );
    await expect(setAdminSnapshot(snapshot)).resolves.toBeUndefined();
  });
});

describe("invalidateAdminSnapshot", () => {
  afterEach(() => vi.clearAllMocks());

  it("deletes the snapshot key", async () => {
    const redis = fakeRedis();
    getRedis.mockReturnValue(redis);
    await invalidateAdminSnapshot("ops@thrivo.fit");
    expect(redis.del).toHaveBeenCalledWith("admin:snapshot:ops@thrivo.fit");
  });

  it("does not throw when Redis throws", async () => {
    getRedis.mockReturnValue(
      fakeRedis({
        del: vi.fn(async () => {
          throw new Error("redis down");
        }),
      })
    );
    await expect(invalidateAdminSnapshot("ops@thrivo.fit")).resolves.toBeUndefined();
  });
});

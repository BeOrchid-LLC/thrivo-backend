import { afterEach, describe, expect, it, vi } from "vitest";

const { getRedis } = vi.hoisted(() => ({ getRedis: vi.fn() }));
vi.mock("../../src/lib/redis", () => ({ getRedis }));

const { touchLastActive } = vi.hoisted(() => ({ touchLastActive: vi.fn() }));
vi.mock("../../src/repositories", () => ({ userRepo: { touchLastActive } }));

import { recordActivity } from "../../src/services/activity.service";

describe("recordActivity throttle", () => {
  afterEach(() => vi.clearAllMocks());

  it("stamps once per window then skips while the gate holds", async () => {
    const set = vi
      .fn()
      .mockResolvedValueOnce("OK") // first request wins the window
      .mockResolvedValueOnce(null); // still inside the window
    getRedis.mockReturnValue({ set });

    await recordActivity("u1");
    await recordActivity("u1");

    expect(touchLastActive).toHaveBeenCalledTimes(1);
    expect(touchLastActive).toHaveBeenCalledWith("u1");
  });

  it("fails open (no touch, no throw) when Redis is unreachable", async () => {
    getRedis.mockReturnValue({
      set: vi.fn(async () => {
        throw new Error("redis down");
      }),
    });
    await expect(recordActivity("u1")).resolves.toBeUndefined();
    expect(touchLastActive).not.toHaveBeenCalled();
  });
});

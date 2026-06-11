import { describe, expect, it, vi } from "vitest";
import { withRetry } from "../../src/lib/retry";

// Deterministic, instant backoff: no real timers, no randomness.
const noSleep = () => Promise.resolve();

describe("withRetry", () => {
  it("returns immediately on first success (no retries)", async () => {
    const fn = vi.fn(async () => "ok");
    const result = await withRetry(fn, { sleep: noSleep });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure then succeeds", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new Error("transient");
      return "recovered";
    });
    const result = await withRetry(fn, { retries: 3, sleep: noSleep });
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("rethrows the last error after exhausting attempts", async () => {
    const fn = vi.fn(async () => {
      throw new Error("always");
    });
    await expect(withRetry(fn, { retries: 2, sleep: noSleep })).rejects.toThrow("always");
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("does not retry when shouldRetry returns false", async () => {
    const fn = vi.fn(async () => {
      throw new Error("permanent");
    });
    await expect(
      withRetry(fn, { retries: 5, shouldRetry: () => false, sleep: noSleep })
    ).rejects.toThrow("permanent");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

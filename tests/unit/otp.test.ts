import { afterEach, describe, expect, it, vi } from "vitest";

const { getRedis } = vi.hoisted(() => ({ getRedis: vi.fn() }));
vi.mock("../../src/lib/redis", () => ({ getRedis }));

import { createOtp } from "../../src/lib/otp";

function fakeRedis() {
  return {
    set: vi.fn(async () => "OK"),
    incr: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
    eval: vi.fn(async () => ["ok", 0]),
  };
}

describe("otp primitive", () => {
  afterEach(() => vi.clearAllMocks());

  it("namespaces redis keys per config (auth-otp vs admin-otp)", async () => {
    const redis = fakeRedis();
    getRedis.mockReturnValue(redis);

    const authOtp = createOtp({ namespace: "auth-otp", ttlSec: 300 });
    const code = await authOtp.issue("user@x.com");
    expect(code).toMatch(/^\d{6}$/);
    expect(redis.set).toHaveBeenCalledWith("auth-otp:user@x.com", expect.any(String), "EX", 300);

    await authOtp.consume("user@x.com", "123456");
    const evalArgs = redis.eval.mock.calls[0]!;
    expect(evalArgs[2]).toBe("auth-otp:user@x.com");
    expect(evalArgs[3]).toBe("auth-otp-attempts:user@x.com");
    expect(evalArgs[4]).toBe("auth-otp-backoff:user@x.com");

    const adminOtp = createOtp({ namespace: "admin-otp", ttlSec: 300 });
    await adminOtp.issue("staff@x.com");
    expect(redis.set).toHaveBeenCalledWith("admin-otp:staff@x.com", expect.any(String), "EX", 300);
  });

  it("stores a hashed code, never the plaintext", async () => {
    const redis = fakeRedis();
    getRedis.mockReturnValue(redis);
    const otp = createOtp({ namespace: "auth-otp", ttlSec: 300 });
    const code = await otp.issue("u@x.com");
    const stored = redis.set.mock.calls[0]![1] as string;
    expect(stored).not.toContain(code!);
    expect(stored).toMatch(/^[a-f0-9]{64}$/); // sha-256 hex
  });

  it("returns null when the issue throttle is exceeded", async () => {
    const redis = fakeRedis();
    redis.incr = vi.fn(async () => 6); // over max 5
    getRedis.mockReturnValue(redis);
    const otp = createOtp({
      namespace: "auth-otp",
      ttlSec: 300,
      throttle: { max: 5, windowSec: 900 },
    });
    expect(await otp.issue("u@x.com")).toBeNull();
  });
});

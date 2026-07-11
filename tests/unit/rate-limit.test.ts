import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

const { getRedis } = vi.hoisted(() => ({ getRedis: vi.fn() }));
vi.mock("../../src/lib/redis", () => ({ getRedis }));

import { rateLimit } from "../../src/middleware/rate-limit";
import { errorHandler } from "../../src/middleware/error";
import { apiErrorSchema } from "../../contracts/src/common";
import type { AppEnv } from "../../src/types/http";

function app() {
  const a = new Hono<AppEnv>();
  a.use(rateLimit({ windowSec: 60, max: 2, keyPrefix: "test" }));
  a.get("/", (c) => c.json({ ok: true }));
  a.onError(errorHandler);
  return a;
}

function countingRedis() {
  let n = 0;
  return {
    incr: vi.fn(async () => ++n),
    expire: vi.fn(async () => 1),
    ttl: vi.fn(async () => 42),
  };
}

describe("rate limiter", () => {
  afterEach(() => vi.clearAllMocks());

  it("allows requests under the cap and blocks over it with 429 + Retry-After", async () => {
    getRedis.mockReturnValue(countingRedis());
    const a = app();

    expect((await a.request("/")).status).toBe(200);
    expect((await a.request("/")).status).toBe(200);

    const blocked = await a.request("/");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("42");
    const body = await blocked.json();
    const parsed = apiErrorSchema.parse(body); // I12: must validate against the published contract
    expect(parsed.success).toBe(false);
    expect(parsed.responseCode).toBe(429);
    expect(parsed.error.code).toBe("RATE_LIMITED");
  });

  it("fails open (serves the request) when Redis is unreachable", async () => {
    getRedis.mockReturnValue({
      incr: vi.fn(async () => {
        throw new Error("redis down");
      }),
      expire: vi.fn(),
      ttl: vi.fn(),
    });

    expect((await app().request("/")).status).toBe(200);
  });
});

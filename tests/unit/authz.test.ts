import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { MiddlewareHandler } from "hono";
import { errorHandler } from "../../src/middleware/error";
import { requireAuth } from "../../src/middleware/require-auth";
import { requirePremium } from "../../src/middleware/require-premium";
import { isPremium, assertPremium } from "../../src/services/entitlement.service";
import { PremiumRequiredError } from "../../src/lib/errors";
import type { AppEnv } from "../../src/types/http";
import type { User } from "../../src/repositories/user.repository";

const free = { id: "u1", tier: "free" } as User;
const premium = { id: "u2", tier: "premium" } as User;

function app(user: User | undefined, gate: MiddlewareHandler<AppEnv>) {
  const a = new Hono<AppEnv>();
  a.onError(errorHandler);
  a.use(async (c, next) => {
    if (user) c.set("user", user);
    await next();
  });
  a.get("/", gate, (c) => c.json({ ok: true }));
  return a;
}

describe("entitlement.service", () => {
  it("reads tier", () => {
    expect(isPremium(premium)).toBe(true);
    expect(isPremium(free)).toBe(false);
  });
  it("assertPremium throws for free users only", () => {
    expect(() => assertPremium(premium)).not.toThrow();
    expect(() => assertPremium(free)).toThrow(PremiumRequiredError);
  });
});

describe("requireAuth", () => {
  it("401 when anonymous, 200 when authenticated", async () => {
    expect((await app(undefined, requireAuth).request("/")).status).toBe(401);
    expect((await app(free, requireAuth).request("/")).status).toBe(200);
  });
});

describe("requirePremium", () => {
  it("401 anonymous, 403 PREMIUM_REQUIRED for free, 200 for premium", async () => {
    expect((await app(undefined, requirePremium).request("/")).status).toBe(401);

    const forbidden = await app(free, requirePremium).request("/");
    expect(forbidden.status).toBe(403);
    expect(((await forbidden.json()) as { error: { code: string } }).error.code).toBe(
      "PREMIUM_REQUIRED"
    );

    expect((await app(premium, requirePremium).request("/")).status).toBe(200);
  });
});

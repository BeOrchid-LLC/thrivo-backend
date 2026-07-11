import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { securityHeaders } from "../../src/middleware/security-headers";
import { corsMiddleware } from "../../src/middleware/cors";
import { bodyLimitMiddleware } from "../../src/middleware/body-limit";
import { errorHandler } from "../../src/middleware/error";
import { apiErrorSchema } from "../../contracts/src/common";
import type { AppEnv } from "../../src/types/http";

function app() {
  const a = new Hono<AppEnv>();
  a.use(securityHeaders);
  a.use(corsMiddleware);
  a.use(bodyLimitMiddleware);
  a.get("/", (c) => c.json({ ok: true }));
  a.post("/", (c) => c.json({ ok: true }));
  a.onError(errorHandler);
  return a;
}

describe("baseline http middleware", () => {
  it("sets security headers", async () => {
    const res = await app().request("/");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("reflects an allowed CORS origin and not a foreign one", async () => {
    const allowed = await app().request("/", { headers: { Origin: "http://localhost:3000" } });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");

    const foreign = await app().request("/", { headers: { Origin: "https://evil.example" } });
    expect(foreign.headers.get("access-control-allow-origin")).not.toBe("https://evil.example");
  });

  it("rejects an oversized body with 413", async () => {
    const res = await app().request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blob: "x".repeat(200 * 1024) }),
    });
    expect(res.status).toBe(413);
    const parsed = apiErrorSchema.parse(await res.json());
    expect(parsed.error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});

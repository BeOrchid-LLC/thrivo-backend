import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { adminOriginGuard } from "../../src/middleware/admin-origin";
import { errorHandler } from "../../src/middleware/error";
import { env } from "../../src/env";
import { ADMIN_COOKIE } from "../../src/admin/session.service";
import type { AppEnv } from "../../src/types/http";

const ALLOWED = env.CORS_ORIGINS[0] ?? "http://localhost:3000";

function app() {
  const a = new Hono<AppEnv>();
  a.onError(errorHandler);
  a.use("*", adminOriginGuard);
  a.get("/x", (c) => c.json({ ok: true }));
  a.post("/x", (c) => c.json({ ok: true }));
  a.delete("/x", (c) => c.json({ ok: true }));
  return a;
}

describe("admin origin guard", () => {
  it("rejects an unsafe request from a foreign origin", async () => {
    const res = await app().request("/x", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  it("allows an unsafe request from an allowlisted origin", async () => {
    const res = await app().request("/x", { method: "POST", headers: { Origin: ALLOWED } });
    expect(res.status).toBe(200);
  });

  it("allows an unsafe request with no Origin and no session cookie (non-browser tooling)", async () => {
    const res = await app().request("/x", { method: "DELETE" });
    expect(res.status).toBe(200);
  });

  it("rejects a cookie-authed unsafe request with no Origin (I9 — the forged-form-post case)", async () => {
    const res = await app().request("/x", {
      method: "POST",
      headers: { Cookie: `${ADMIN_COOKIE}=some-signed-jwt` },
    });
    expect(res.status).toBe(403);
  });

  it("still allows an allowlisted-Origin request even when the cookie is present", async () => {
    const res = await app().request("/x", {
      method: "POST",
      headers: { Origin: ALLOWED, Cookie: `${ADMIN_COOKIE}=some-signed-jwt` },
    });
    expect(res.status).toBe(200);
  });

  it("never blocks safe methods, even cross-origin", async () => {
    const res = await app().request("/x", { headers: { Origin: "https://evil.example" } });
    expect(res.status).toBe(200);
  });
});

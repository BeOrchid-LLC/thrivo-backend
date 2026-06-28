import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { adminOriginGuard } from "../../src/middleware/admin-origin";
import { errorHandler } from "../../src/middleware/error";
import { env } from "../../src/env";
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

  it("allows an unsafe request with no Origin (non-browser tooling)", async () => {
    const res = await app().request("/x", { method: "DELETE" });
    expect(res.status).toBe(200);
  });

  it("never blocks safe methods, even cross-origin", async () => {
    const res = await app().request("/x", { headers: { Origin: "https://evil.example" } });
    expect(res.status).toBe(200);
  });
});

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { bodyLimitMiddleware } from "../../src/middleware/body-limit";
import { errorHandler } from "../../src/middleware/error";
import { apiErrorSchema } from "../../contracts/src/common";
import type { AppEnv } from "../../src/types/http";

function app() {
  const a = new Hono<AppEnv>();
  a.use(bodyLimitMiddleware);
  a.post("/", (c) => c.json({ ok: true }));
  a.onError(errorHandler);
  return a;
}

describe("body limit middleware (I12)", () => {
  it("passes bodies under the cap through", async () => {
    const res = await app().request("/", { method: "POST", body: "x".repeat(1024) });
    expect(res.status).toBe(200);
  });

  it("rejects oversized bodies with a 413 that validates against the error contract", async () => {
    const res = await app().request("/", {
      method: "POST",
      body: "x".repeat(200 * 1024),
    });
    expect(res.status).toBe(413);
    const parsed = apiErrorSchema.parse(await res.json());
    expect(parsed.success).toBe(false);
    expect(parsed.responseCode).toBe(413);
    expect(parsed.error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});

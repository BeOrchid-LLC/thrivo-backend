import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { validate } from "../../src/middleware/validate";
import { errorHandler } from "../../src/middleware/error";
import type { AppEnv } from "../../src/types/http";

const schema = z.object({ email: z.string().email(), age: z.number().int().positive() });

function app() {
  const a = new Hono<AppEnv>();
  a.onError(errorHandler);
  a.post("/", validate("json", schema), (c) => c.json({ data: c.req.valid("json") }));
  return a;
}

describe("validate middleware", () => {
  it("passes valid input through to the handler", async () => {
    const res = await app().request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@b.com", age: 30 }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ email: "a@b.com", age: 30 });
  });

  it("rejects invalid input with a 422 in the standard error shape + details", async () => {
    const res = await app().request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "nope", age: -1 }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: { code: string; details: { fieldErrors: Record<string, string[]> } };
    };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.fieldErrors.email).toBeDefined();
    expect(body.error.details.fieldErrors.age).toBeDefined();
  });
});

import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import type { ZodSchema } from "zod";
import { ValidationError } from "../lib/errors";

type Target = "json" | "query" | "param" | "header" | "cookie" | "form";

/**
 * Per-route Zod validation. On failure throws our `ValidationError` so the error
 * boundary returns `422` `{ error: { code:"VALIDATION_ERROR", details } }` — one
 * consistent shape across every endpoint. On success the parsed, typed value is
 * read with `c.req.valid(target)`.
 */
export function validate<T extends ZodSchema>(target: Target, schema: T) {
  return zValidator(target, schema, (result) => {
    if (!result.success) {
      throw new ValidationError("Validation failed", result.error.flatten());
    }
  });
}

/**
 * Read parsed validation output without losing HonoRequest's method binding.
 * Calling a saved `c.req.valid` reference throws because it relies on `this`.
 */
export function getValidatedInput(c: Context, target: Target): unknown {
  return (c.req.valid as (target: Target) => unknown).call(c.req, target);
}

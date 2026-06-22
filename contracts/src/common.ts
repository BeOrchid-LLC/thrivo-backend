import { z } from "zod";

export const errorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "PREMIUM_REQUIRED",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "UPSTREAM_ERROR",
  "INTERNAL_ERROR",
]);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const metaSchema = z
  .object({
    nextCursor: z.string().nullable().optional(),
  })
  .catchall(z.unknown());

export type Meta = z.infer<typeof metaSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export function apiSuccessSchema<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    data,
    meta: metaSchema.optional(),
  });
}

export type ApiSuccess<T> = {
  data: T;
  meta?: Meta;
};

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export type RouteContract = {
  method: HttpMethod;
  path: `/api/v1/${string}`;
  auth: "public" | "user" | "admin" | "signature";
};

// ---------------------------------------------------------------------------
// Utility aliases used by admin-panel consumers
// ---------------------------------------------------------------------------

/** Generic success envelope `{ data: T, meta? }` — admin-panel alias of apiSuccessSchema. */
export const successEnvelope = apiSuccessSchema;

/** Untyped primitive schemas for ID fields and ISO date strings. */
export const idSchema = z.string().min(1);
export const isoDateSchema = z.string();

/** Named time-series point used in admin analytics charts. */
export const timePointSchema = z.object({ date: z.string(), value: z.number() });
export type TimePoint = z.infer<typeof timePointSchema>;

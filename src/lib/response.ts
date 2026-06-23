import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "../types/http";

/**
 * Single response helper for success paths. Stamps `success: true`, the HTTP
 * status code, and a human-readable message into the body alongside `data` so
 * clients can branch on `success` alone rather than inspecting HTTP status or
 * key presence.
 *
 * 204 No Content endpoints (logout, soft-delete) bypass this and use
 * `c.body(null, 204)` directly — they carry no payload.
 */
export function respondOk<T>(
  c: Context<AppEnv>,
  data: T,
  message = "Success",
  status: ContentfulStatusCode = 200
) {
  return c.json({ success: true, data, responseCode: status, message }, status);
}

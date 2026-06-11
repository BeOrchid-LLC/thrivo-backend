import { createMiddleware } from "hono/factory";
import { newId } from "../lib/ids";
import type { AppEnv } from "../types/http";

/** Correlation-id header. Cloudflare/Traefik forward an inbound one if present. */
export const REQUEST_ID_HEADER = "x-request-id";

// Accept a sane inbound id (bounded, printable, no header-injection chars); mint
// a fresh UUIDv7 otherwise so an attacker can't force unbounded or hostile ids.
const VALID_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * First middleware in the pipeline: carry the edge's `x-request-id` when valid,
 * else mint one. Stored on `c.var.requestId` and echoed back on the response so
 * clients and support can correlate a request across logs and Sentry.
 */
export const requestId = createMiddleware<AppEnv>(async (c, next) => {
  const inbound = c.req.header(REQUEST_ID_HEADER);
  const id = inbound && VALID_REQUEST_ID.test(inbound) ? inbound : newId();
  c.set("requestId", id);
  c.header(REQUEST_ID_HEADER, id);
  await next();
});

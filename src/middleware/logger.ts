import { createMiddleware } from "hono/factory";
import { logger } from "../lib/logger";
import type { AppEnv } from "../types/http";

/**
 * Request-scoped logging. Binds a child logger carrying the correlation id to
 * `c.var.logger` (so handlers/services log with it), then emits one line per
 * request on finish: method, path, status, duration. Level tracks the outcome
 * — 5xx → error, 4xx → warn, else info.
 *
 * Hono-native by design: `pino-http` targets raw Node req/res, not Hono's
 * fetch model, so we bind a child logger directly. Must run after `request-id`.
 */
export const requestLogger = createMiddleware<AppEnv>(async (c, next) => {
  const log = logger.child({ requestId: c.var.requestId });
  c.set("logger", log);

  const start = Date.now();
  await next();
  const durationMs = Date.now() - start;

  const fields = {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs,
  };
  if (c.res.status >= 500) log.error(fields, "request");
  else if (c.res.status >= 400) log.warn(fields, "request");
  else log.info(fields, "request");
});

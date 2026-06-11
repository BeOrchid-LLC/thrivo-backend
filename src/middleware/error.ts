import type { ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import * as Sentry from "@sentry/node";
import { env } from "../env";
import { AppError } from "../lib/errors";
import type { AppEnv } from "../types/http";

/**
 * Central error boundary. Domain `AppError`s map to their status + stable code
 * (the documented `{ error: { code, message, details? } }` contract). Anything
 * else is an unhandled bug: log it with the request logger, report to Sentry
 * tagged with the correlation id, and return a generic 500 carrying the
 * `requestId` so support can tie a user report back to the exact logs/event.
 * The stack/message is never leaked to clients in production.
 */
export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
  if (err instanceof AppError) {
    return c.json(
      { error: { code: err.code, message: err.message, details: err.details } },
      err.status as ContentfulStatusCode
    );
  }

  const requestId = c.var.requestId;
  c.var.logger.error({ err }, "unhandled error");
  Sentry.withScope((scope) => {
    scope.setTag("request_id", requestId);
    scope.setContext("request", { method: c.req.method, path: c.req.path });
    Sentry.captureException(err);
  });

  return c.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: env.NODE_ENV === "production" ? "Internal server error" : String(err),
        requestId,
      },
    },
    500
  );
};

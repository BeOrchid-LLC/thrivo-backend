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
    const message = err.message;
    return c.json(
      {
        success: false,
        error: { code: err.code, message, details: err.details },
        responseCode: err.status,
        message,
      },
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

  const message = env.NODE_ENV === "production" ? "Internal server error" : String(err);
  return c.json(
    {
      success: false,
      error: { code: "INTERNAL_ERROR", message, requestId },
      responseCode: 500,
      message,
    },
    500
  );
};

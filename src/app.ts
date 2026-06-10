import { Hono } from "hono";
import { logger as honoLogger } from "hono/logger";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import * as Sentry from "@sentry/node";
import { env } from "./env";
import { pingDb } from "../db";
import { pingRedis } from "./lib/redis";
import { AppError } from "./lib/errors";

/**
 * Builds the configured Hono app without starting a listener, so integration
 * tests can import it directly. Process concerns (env, Sentry, serve, signals)
 * live in index.ts. The full middleware pipeline + routers land in A1-3/A1-6.
 */
export function buildApp(): Hono {
  const app = new Hono();

  app.use(honoLogger());

  // Liveness — the process is up.
  app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

  // Readiness — dependencies are reachable. 503 when degraded so orchestrators hold traffic.
  app.get("/ready", async (c) => {
    const [database, redis] = await Promise.all([pingDb().catch(() => false), pingRedis()]);
    const ready = database && redis;
    return c.json(
      { status: ready ? "ready" : "degraded", checks: { database, redis } },
      ready ? 200 : 503
    );
  });

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json(
        { error: { code: err.code, message: err.message, details: err.details } },
        err.status as ContentfulStatusCode
      );
    }
    Sentry.captureException(err);
    return c.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: env.NODE_ENV === "production" ? "Internal server error" : err.message,
        },
      },
      500
    );
  });

  return app;
}

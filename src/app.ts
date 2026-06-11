import { Hono } from "hono";
import { env } from "./env";
import { pingDb } from "../db";
import { pingRedis } from "./lib/redis";
import { requestId } from "./middleware/request-id";
import { requestLogger } from "./middleware/logger";
import { errorHandler } from "./middleware/error";
import type { AppEnv } from "./types/http";

/**
 * Builds the configured Hono app without starting a listener, so integration
 * tests can import it directly. Process concerns (env, Sentry, serve, signals)
 * live in index.ts. The full middleware pipeline + routers land in A1-3/A1-6.
 */
export function buildApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Correlation id first so every downstream log/error carries it, then the
  // request-scoped logger that binds the id and logs each request on finish.
  app.use(requestId);
  app.use(requestLogger);

  // Liveness — the process is up. No I/O; reports the running build + uptime so
  // a probe response also confirms which version answered.
  app.get("/health", (c) =>
    c.json({
      status: "ok",
      version: env.GIT_SHA ?? "dev",
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    })
  );

  // Readiness — dependencies are reachable. 503 when degraded so orchestrators hold traffic.
  app.get("/ready", async (c) => {
    const [database, redis] = await Promise.all([pingDb().catch(() => false), pingRedis()]);
    const ready = database && redis;
    return c.json(
      { status: ready ? "ready" : "degraded", checks: { database, redis } },
      ready ? 200 : 503
    );
  });

  app.onError(errorHandler);

  return app;
}

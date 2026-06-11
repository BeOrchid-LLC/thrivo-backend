import { Hono } from "hono";
import { env } from "./env";
import { pingDb } from "../db";
import { pingRedis } from "./lib/redis";
import { requestId } from "./middleware/request-id";
import { requestLogger } from "./middleware/logger";
import { securityHeaders } from "./middleware/security-headers";
import { corsMiddleware } from "./middleware/cors";
import { bodyLimitMiddleware } from "./middleware/body-limit";
import { errorHandler } from "./middleware/error";
import type { AppEnv } from "./types/http";

/**
 * Builds the configured Hono app without starting a listener, so integration
 * tests can import it directly. Process concerns (env, Sentry, serve, signals)
 * live in index.ts. Auth + per-route validation/rate-limit land on the routers.
 */
export function buildApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Pipeline order (BACKEND_ARCHITECTURE §5): correlation id → request logger →
  // security headers → CORS → body limit. Auth + rate-limit attach to routers.
  app.use(requestId);
  app.use(requestLogger);
  app.use(securityHeaders);
  app.use(corsMiddleware);
  app.use(bodyLimitMiddleware);

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

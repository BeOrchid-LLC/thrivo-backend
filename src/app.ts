import { Hono } from "hono";
import { env } from "./env";
import { pingDb } from "../db";
import { pingRedis } from "./lib/redis";
import { requestId } from "./middleware/request-id";
import { requestLogger } from "./middleware/logger";
import { securityHeaders } from "./middleware/security-headers";
import { corsMiddleware } from "./middleware/cors";
import { bodyLimitMiddleware } from "./middleware/body-limit";
import { apiRateLimit, authRateLimit } from "./middleware/rate-limit";
import { authMiddleware } from "./middleware/auth";
import { authHandler } from "./auth";
import { authRouter } from "./routes/auth";
import { usersRouter } from "./routes/users";
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

  // General per-IP ceiling on the API surface only — health/ready probes are
  // exempt (not under /api/v1).
  app.use("/api/v1/*", apiRateLimit);

  // Resolve the session → c.var.user for every API request (non-fatal).
  app.use("/api/v1/*", authMiddleware);

  // Auth endpoints share a tighter rate-limit bucket (credential/OTP abuse).
  app.use("/api/v1/auth/*", authRateLimit);

  // Hand-rolled auth (magic link; Google OAuth in Phase 3) — registered ahead of
  // the legacy BetterAuth catch-all so these specific routes take precedence.
  app.route("/api/v1/auth", authRouter);

  // Legacy BetterAuth handles any remaining /api/v1/auth/** paths (sign-in/out,
  // existing sessions) during migration; removed at cutover (Phase 5).
  app.on(["POST", "GET"], "/api/v1/auth/*", (c) => authHandler(c.req.raw));

  // Feature routers (auth-gated). /users/me is the A1 reference route; A2 adds the rest.
  app.route("/api/v1/users", usersRouter);

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

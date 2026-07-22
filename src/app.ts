import { Hono } from "hono";
import { env } from "./env";
import { pingDb } from "../db";
import { pingRedis } from "./lib/redis";
import { requestId } from "./middleware/request-id";
import { requestLogger } from "./middleware/logger";
import { securityHeaders } from "./middleware/security-headers";
import { corsMiddleware } from "./middleware/cors";
import { bodyLimitMiddleware } from "./middleware/body-limit";
import { apiRateLimit } from "./middleware/rate-limit";
import { authMiddleware } from "./middleware/auth";
import { usersRouter } from "./routes/users";
import { uploadsRouter } from "./routes/uploads";
import { dashboardRouter } from "./routes/dashboard";
import { foodsRouter } from "./routes/foods";
import { metricsRouter } from "./routes/metrics";
import { subscriptionsRouter } from "./routes/subscriptions";
import { checkinsRouter } from "./routes/checkins";
import { leadsRouter } from "./routes/leads";
import { webhooksRouter } from "./routes/webhooks";
import { adminRouter } from "./routes/admin";
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

  // Feature routers (auth-gated). /users/me is the A1 reference route; A2 adds the rest.
  app.route("/api/v1/users", usersRouter);
  app.route("/api/v1/uploads", uploadsRouter);
  app.route("/api/v1/dashboard", dashboardRouter);
  app.route("/api/v1/foods", foodsRouter);
  app.route("/api/v1/metrics", metricsRouter);
  app.route("/api/v1/subscriptions", subscriptionsRouter);
  app.route("/api/v1/checkins", checkinsRouter);

  // Public, unauthenticated email-capture surface (marketing site CTA form).
  // Sits under the general authMiddleware above, which is non-fatal and never
  // blocks anonymous requests — this route uses neither requireAuth nor
  // requireAdmin, so it's reachable with no session at all.
  app.route("/api/v1/leads", leadsRouter);

  // Provider webhooks — authenticated by a shared secret in the handler, not the
  // user session. RevenueCat entitlement events are the source of truth.
  app.route("/api/v1/webhooks", webhooksRouter);

  // Admin surface (staff only, OTP + cookie session).
  app.route("/api/v1/admin", adminRouter);

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

import { serve } from "@hono/node-server";
import * as Sentry from "@sentry/node";
import { env } from "./env";
import { buildApp } from "./app";
import { logger } from "./lib/logger";
import { closeDb, pingDb } from "../db";
import { closeRedis, pingRedis } from "./lib/redis";
import { runMigrations } from "../db/migrate";

// Process bootstrap: validate env (on import) → init Sentry → build app → serve →
// register graceful shutdown so Coolify/Docker rolling redeploys don't drop requests.

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: env.GIT_SHA,
    tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 1.0,
  });
}

const app = buildApp();

/** Bound a dependency probe so a hung/unreachable service can't stall startup. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms).unref();
    }),
  ]);
}

/**
 * Verify dependencies before binding the listener. Postgres is required — an
 * unreachable DB exits non-zero so a bad DATABASE_URL fails the deploy loudly
 * instead of surfacing on the first request. Redis backs cache + the BullMQ
 * broker but the API can serve degraded, so a failure warns and continues
 * (ioredis reconnects on its own). Both probes are time-bounded.
 */
async function verifyDependencies(): Promise<void> {
  try {
    await withTimeout(pingDb(), 5000, "database ping");
    logger.info("database connected");
  } catch (err) {
    logger.fatal({ err }, "database unreachable at startup — refusing to start");
    await Sentry.flush(2000);
    process.exit(1);
  }

  // pingRedis() resolves false on failure and getRedis() logs "redis connected"
  // on the connect event; the timeout guards against a hang while Redis is down.
  let redisReady = false;
  try {
    redisReady = await withTimeout(pingRedis(), 5000, "redis ping");
  } catch (err) {
    logger.error({ err }, "redis check errored at startup");
  }
  if (!redisReady) {
    logger.warn("redis unreachable at startup — continuing in degraded mode");
  }
}

await verifyDependencies();
await runMigrations();

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info({ port: info.port }, "thrivo-backend listening");
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "graceful shutdown: draining");
  server.close();
  await closeDb();
  await closeRedis();
  // Flush any buffered error reports before the process exits so a crash-on-deploy
  // doesn't drop the event that explains it. No-op when Sentry isn't initialized.
  await Sentry.flush(2000);
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

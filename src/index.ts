import { serve } from "@hono/node-server";
import * as Sentry from "@sentry/node";
import { env } from "./env";
import { buildApp } from "./app";
import { logger } from "./lib/logger";
import { closeDb, pingDb } from "../db";
import { closeRedis, pingRedis } from "./lib/redis";
import { runDeferredMigrations, runMigrations } from "../db/migrate";

// Process bootstrap: validate env (on import) → init Sentry → verify required
// dependencies/schema → serve → run optional index work in the background →
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
      setTimeout(() => reject(new Error(label + " timed out after " + ms + "ms")), ms).unref();
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

async function delayForRetry(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
}

async function runDeferredMigrationsWithRetry(
  deferredTags: string[],
  shouldStop: () => boolean
): Promise<void> {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (shouldStop()) return;
    try {
      logger.info({ deferredTags, attempt }, "deferred migration attempt started");
      await runDeferredMigrations(shouldStop);
      logger.info({ deferredTags, attempt }, "deferred migrations completed");
      return;
    } catch (err) {
      if (attempt === maxAttempts || shouldStop()) throw err;
      logger.warn(
        { err, deferredTags, attempt, nextAttempt: attempt + 1 },
        "deferred migrations failed; retrying"
      );
      await delayForRetry(5000);
    }
  }
}

await verifyDependencies();
const { deferredTags } = await runMigrations("startup");

let shuttingDown = false;
let stopDeferredMigrations = () => {};
let deferredMigrationTask: Promise<void> | undefined;

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info({ port: info.port }, "thrivo-backend listening");
});

if (deferredTags.length > 0) {
  let stopRequested = false;
  stopDeferredMigrations = () => {
    stopRequested = true;
  };

  deferredMigrationTask = runDeferredMigrationsWithRetry(deferredTags, () => stopRequested).catch(
    (err) => {
      logger.error({ err, deferredTags }, "deferred migration failed after API startup");
      Sentry.captureException(err);
    }
  );
  logger.info({ deferredTags }, "deferred migrations started after API startup");
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  stopDeferredMigrations();
  if (deferredMigrationTask) {
    await Promise.race([
      deferredMigrationTask,
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 5000);
        timer.unref();
      }),
    ]);
  }
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

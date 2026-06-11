import { serve } from "@hono/node-server";
import * as Sentry from "@sentry/node";
import { env } from "./env";
import { buildApp } from "./app";
import { logger } from "./lib/logger";
import { closeDb } from "../db";
import { closeRedis } from "./lib/redis";

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

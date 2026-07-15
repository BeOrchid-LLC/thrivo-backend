import { Worker, type Job } from "bullmq";
import { redisConnectionOptions } from "../lib/queue/connection";
import { QUEUE_NAMES, getQueue, type QueueName } from "../lib/queue";
import { handleSendEmail } from "./handlers/send-email";
import { handleMaintenance } from "./handlers/maintenance";
import { handleSendNudge } from "./handlers/send-nudge";
import { seedStarterTips } from "./seed-tips";
import { logger } from "../lib/logger";
import { closeDb } from "../../db";
import { closeRedis } from "../lib/redis";

// Separate process (Coolify service `thrivo-worker`, count=1) so API replicas never
// double-fire scheduled sends. Live queues:
//   emails      → send-email (renders + sends via Resend, records email_logs)
//   nudges      → send-nudge (daily psychology tip → Expo Push)
//   maintenance → reconcile-daily-summaries · trial-reminder · reconcile-subscriptions · weekly-review
//   analytics   → server-side product events                                   [stub]

const workers: Worker[] = [];

// Per-queue handlers. The maintenance queue routes by job name; queues without a
// handler fall back to a logging stub.
const handlers: Partial<Record<QueueName, (job: Job) => Promise<void>>> = {
  [QUEUE_NAMES.emails]: handleSendEmail as (job: Job) => Promise<void>,
  [QUEUE_NAMES.nudges]: handleSendNudge,
  [QUEUE_NAMES.maintenance]: handleMaintenance,
};

// Bounded fan-out per queue (default 1 — BullMQ's own default). The nudges
// queue now carries one job per Expo-sized chunk (R5-3/I15); a small cap lets
// those drain faster than strictly sequential without thundering-herding Expo.
const WORKER_CONCURRENCY: Partial<Record<QueueName, number>> = {
  [QUEUE_NAMES.nudges]: 5,
};

function jobLogContext(queue: QueueName, job: Job): Record<string, unknown> {
  return {
    queue,
    jobId: job.id,
    jobName: job.name,
    attempt: job.attemptsMade + 1,
    maxAttempts: job.opts.attempts ?? 1,
  };
}

function startWorker(name: QueueName): void {
  const handler = handlers[name];
  const concurrency = WORKER_CONCURRENCY[name] ?? 1;
  logger.info({ queue: name, concurrency, hasHandler: Boolean(handler) }, "worker queue starting");

  const worker = new Worker(
    name,
    async (job: Job) => {
      const context = jobLogContext(name, job);
      const startedAt = Date.now();
      logger.info(context, "worker job started");

      if (handler) {
        await handler(job);
      } else {
        logger.info(context, "worker job skipped: no handler registered");
      }

      logger.info({ ...context, durationMs: Date.now() - startedAt }, "worker job completed");
    },
    { connection: redisConnectionOptions, concurrency }
  );
  worker.on("ready", () => logger.info({ queue: name, concurrency }, "worker queue ready"));
  worker.on("stalled", (jobId) => logger.warn({ queue: name, jobId }, "worker job stalled"));
  worker.on("error", (err) => logger.error({ queue: name, err }, "worker queue error"));
  worker.on("failed", (job, err) => {
    if (!job) {
      logger.error({ queue: name, err }, "worker job failed without job details");
      return;
    }
    logger.error(
      { ...jobLogContext(name, job), attemptsMade: job.attemptsMade, err },
      "worker job failed and was returned to the queue"
    );
  });
  workers.push(worker);
}

/** Idempotent repeatable jobs — upsertJobScheduler dedupes by scheduler id. */
async function registerSchedulers(): Promise<void> {
  const maintenance = getQueue(QUEUE_NAMES.maintenance);
  await maintenance.upsertJobScheduler(
    "reconcile-daily-summaries",
    { pattern: "0 3 * * *", tz: "UTC" },
    { name: "reconcile-daily-summaries", data: {} }
  );
  logger.info(
    {
      queue: QUEUE_NAMES.maintenance,
      schedulerId: "reconcile-daily-summaries",
      pattern: "0 3 * * *",
      timezone: "UTC",
    },
    "worker scheduler registered"
  );
  await maintenance.upsertJobScheduler(
    "reconcile-subscriptions",
    { pattern: "30 3 * * *", tz: "UTC" },
    { name: "reconcile-subscriptions", data: {} }
  );
  logger.info(
    {
      queue: QUEUE_NAMES.maintenance,
      schedulerId: "reconcile-subscriptions",
      pattern: "30 3 * * *",
      timezone: "UTC",
    },
    "worker scheduler registered"
  );
  await maintenance.upsertJobScheduler(
    "trial-reminder",
    { pattern: "0 9 * * *", tz: "UTC" },
    { name: "trial-reminder", data: {} }
  );
  logger.info(
    {
      queue: QUEUE_NAMES.maintenance,
      schedulerId: "trial-reminder",
      pattern: "0 9 * * *",
      timezone: "UTC",
    },
    "worker scheduler registered"
  );
  // After reconcile-subscriptions (03:30 UTC) so today's expirations are
  // already reflected in `subscriptions.status` before the snapshot reads it.
  await maintenance.upsertJobScheduler(
    "snapshot-mrr",
    { pattern: "0 4 * * *", tz: "UTC" },
    { name: "snapshot-mrr", data: {} }
  );
  logger.info(
    {
      queue: QUEUE_NAMES.maintenance,
      schedulerId: "snapshot-mrr",
      pattern: "0 4 * * *",
      timezone: "UTC",
    },
    "worker scheduler registered"
  );
  await getQueue(QUEUE_NAMES.nudges).upsertJobScheduler(
    "send-daily-nudges",
    { pattern: "0 8 * * *", tz: "UTC" },
    { name: "send-daily-nudges", data: {} }
  );
  logger.info(
    {
      queue: QUEUE_NAMES.nudges,
      schedulerId: "send-daily-nudges",
      pattern: "0 8 * * *",
      timezone: "UTC",
    },
    "worker scheduler registered"
  );
  // Hourly, not daily: each run only touches the timezone bucket currently at
  // TARGET_LOCAL_HOUR (weekly-review.ts), so the send lands near each user's
  // local morning instead of one fixed UTC time for everyone.
  await maintenance.upsertJobScheduler(
    "weekly-review",
    { pattern: "0 * * * *", tz: "UTC" },
    { name: "weekly-review", data: {} }
  );
  logger.info(
    {
      queue: QUEUE_NAMES.maintenance,
      schedulerId: "weekly-review",
      pattern: "0 * * * *",
      timezone: "UTC",
    },
    "worker scheduler registered"
  );
  logger.info("worker scheduler registration complete");
}

async function main(): Promise<void> {
  logger.info({ queues: Object.values(QUEUE_NAMES) }, "thrivo-worker starting");
  for (const name of Object.values(QUEUE_NAMES)) startWorker(name);
  logger.info("worker starter-tip seed starting");
  const seeded = await seedStarterTips();
  logger.info({ seeded }, "worker starter-tip seed complete");
  await registerSchedulers();
  logger.info({ queueCount: workers.length }, "thrivo-worker ready");
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal, queueCount: workers.length }, "thrivo-worker shutdown starting");
  await Promise.all(workers.map((w) => w.close()));
  logger.info("worker queues closed");
  await closeRedis();
  logger.info("worker redis connection closed");
  await closeDb();
  logger.info("worker database connection closed");
  logger.info({ signal }, "thrivo-worker shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

main().catch((err) => {
  logger.fatal({ err }, "thrivo-worker failed to start");
  process.exit(1);
});

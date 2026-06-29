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
//   maintenance → reconcile-daily-summaries · trial-reminder · reconcile-subscriptions
//   analytics   → server-side product events                                   [stub]

const workers: Worker[] = [];

// Per-queue handlers. The maintenance queue routes by job name; queues without a
// handler fall back to a logging stub.
const handlers: Partial<Record<QueueName, (job: Job) => Promise<void>>> = {
  [QUEUE_NAMES.emails]: handleSendEmail as (job: Job) => Promise<void>,
  [QUEUE_NAMES.nudges]: handleSendNudge,
  [QUEUE_NAMES.maintenance]: handleMaintenance,
};

function startWorker(name: QueueName): void {
  const handler = handlers[name];
  const worker = new Worker(
    name,
    async (job: Job) => {
      if (handler) return handler(job);
      logger.info({ queue: name, jobId: job.id, jobName: job.name }, "job received (stub handler)");
    },
    { connection: redisConnectionOptions }
  );
  worker.on("failed", (job, err) => logger.error({ err, jobId: job?.id }, "job failed"));
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
  await maintenance.upsertJobScheduler(
    "reconcile-subscriptions",
    { pattern: "30 3 * * *", tz: "UTC" },
    { name: "reconcile-subscriptions", data: {} }
  );
  await maintenance.upsertJobScheduler(
    "trial-reminder",
    { pattern: "0 9 * * *", tz: "UTC" },
    { name: "trial-reminder", data: {} }
  );
  await getQueue(QUEUE_NAMES.nudges).upsertJobScheduler(
    "send-daily-nudges",
    { pattern: "0 8 * * *", tz: "UTC" },
    { name: "send-daily-nudges", data: {} }
  );
  logger.info("schedulers registered");
}

async function main(): Promise<void> {
  logger.info("thrivo-worker starting");
  for (const name of Object.values(QUEUE_NAMES)) startWorker(name);
  const seeded = await seedStarterTips();
  if (seeded > 0) logger.info({ seeded }, "starter tips seeded");
  await registerSchedulers();
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "thrivo-worker shutting down");
  await Promise.all(workers.map((w) => w.close()));
  await closeRedis();
  await closeDb();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

main().catch((err) => {
  logger.fatal({ err }, "thrivo-worker failed to start");
  process.exit(1);
});

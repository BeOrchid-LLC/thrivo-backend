import { Worker, type Job } from "bullmq";
import { redisConnectionOptions } from "../lib/queue/connection";
import { QUEUE_NAMES, type QueueName } from "../lib/queue";
import { handleSendEmail } from "./handlers/send-email";
import { logger } from "../lib/logger";
import { closeDb } from "../../db";
import { closeRedis } from "../lib/redis";

// Separate process (Coolify service `thrivo-worker`, count=1) so API replicas never
// double-fire scheduled sends. The `emails` queue is live (A1-8); the rest stay
// stubbed until their feature phase:
//   emails    → send-email (renders + sends via Resend, records email_logs)  [A1-8]
//   nudges    → send-nudge (daily tip rotation → Expo Push)                  [A2]
//   analytics → server-side product events                                  [A2]
// Repeatable schedulers (trial-reminder, reconcile-subscriptions) are registered here in A2.

const workers: Worker[] = [];

// Per-queue handlers. Queues without one fall back to a logging stub.
const handlers: Partial<Record<QueueName, (job: Job) => Promise<void>>> = {
  [QUEUE_NAMES.emails]: handleSendEmail as (job: Job) => Promise<void>,
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

function main(): void {
  logger.info("thrivo-worker starting");
  for (const name of Object.values(QUEUE_NAMES)) startWorker(name);
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

main();

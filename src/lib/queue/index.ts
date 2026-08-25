import { Queue, type JobsOptions } from "bullmq";
import { redisConnectionOptions } from "./connection";
import { logger } from "../logger";

/** The queues Thrivo dispatches to. Concrete job payloads are typed with their feature phase. */
export const QUEUE_NAMES = {
  emails: "emails", // welcome / trial-ending / cancellation (A2/A5)
  nudges: "nudges", // psychology-tip and food-log push delivery (A2)
  analytics: "analytics", // server-side product events (A2)
  maintenance: "maintenance", // repeatable system jobs (reconcile rollups, etc.)
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: redisConnectionOptions });
    queues.set(name, q);
  }
  return q;
}

/**
 * Enqueue a job. On failure it logs and rethrows — a dropped side-effect must be
 * visible to the caller, never silently swallowed.
 */
export async function enqueue(
  queueName: QueueName,
  jobName: string,
  data: unknown,
  opts?: JobsOptions
): Promise<void> {
  try {
    await getQueue(queueName).add(jobName, data, opts);
  } catch (err) {
    logger.error({ err, queueName, jobName }, "enqueue failed");
    throw err;
  }
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
}

import type { Job } from "bullmq";
import { logger } from "../../lib/logger";
import { sendDailyNudges } from "../../services/nudge.service";
import { handleSendNudgeChunk } from "./send-nudge-chunk";

/**
 * Router for the `nudges` queue (R5-3/I15): the daily scheduler job dispatches
 * (pages tokens, enqueues per-chunk jobs) and each `send-nudge-chunk` job sends
 * one Expo-sized batch. Two job names sharing one queue, same pattern as the
 * `maintenance` queue's router.
 */
const routes: Record<string, (job: Job) => Promise<void>> = {
  "send-daily-nudges": async () => {
    await sendDailyNudges();
  },
  "send-nudge-chunk": handleSendNudgeChunk as (job: Job) => Promise<void>,
};

export async function handleSendNudge(job: Job): Promise<void> {
  const route = routes[job.name];
  if (!route) {
    logger.warn({ jobId: job.id, jobName: job.name }, "unknown nudges job");
    return;
  }
  logger.info({ jobId: job.id, jobName: job.name }, "nudge job dispatching");
  return route(job);
}

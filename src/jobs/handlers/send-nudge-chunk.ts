import type { Job } from "bullmq";
import { pushTokenRepo } from "../../repositories";
import { sendExpoPushBatch, type ExpoPushMessage } from "../../integrations/expo-push";
import type { NudgeChunkJobData } from "../../services/nudge.service";
import { logger } from "../../lib/logger";

/**
 * Worker handler for one `send-nudge-chunk` job: a single Expo-sized batch of
 * the daily nudge (R5-3/I15). A timeout or non-2xx throws so BullMQ retries
 * only this batch — never the tens of thousands of tokens already delivered
 * in earlier chunks.
 */
export async function handleSendNudgeChunk(job: Job<NudgeChunkJobData>): Promise<void> {
  const { tipId, tipBody, tokens } = job.data;
  logger.info({ jobId: job.id, tipId, tokenCount: tokens.length }, "nudge chunk prepared");
  const messages: ExpoPushMessage[] = tokens.map((to) => ({
    to,
    title: "Thrivo",
    body: tipBody,
    data: { screen: "checkin", tipId },
  }));

  logger.info({ jobId: job.id, tokenCount: tokens.length }, "nudge provider send started");
  const { invalidTokens } = await sendExpoPushBatch(messages);
  logger.info(
    { jobId: job.id, tokenCount: tokens.length, invalidTokenCount: invalidTokens.length },
    "nudge provider send complete"
  );
  if (invalidTokens.length > 0) {
    logger.info(
      { jobId: job.id, invalidTokenCount: invalidTokens.length },
      "invalid nudge tokens pruning started"
    );
    await pushTokenRepo.pruneInvalid(invalidTokens);
    logger.info(
      { jobId: job.id, invalidTokenCount: invalidTokens.length },
      "invalid nudge tokens pruning complete"
    );
  }
}

import type { Job } from "bullmq";
import { pushTokenRepo } from "../../repositories";
import { sendExpoPushBatch, type ExpoPushMessage } from "../../integrations/expo-push";
import type { NudgeChunkJobData } from "../../services/nudge.service";

/**
 * Worker handler for one `send-nudge-chunk` job: a single Expo-sized batch of
 * the daily nudge (R5-3/I15). A timeout or non-2xx throws so BullMQ retries
 * only this batch — never the tens of thousands of tokens already delivered
 * in earlier chunks.
 */
export async function handleSendNudgeChunk(job: Job<NudgeChunkJobData>): Promise<void> {
  const { tipId, tipBody, tokens } = job.data;
  const messages: ExpoPushMessage[] = tokens.map((to) => ({
    to,
    title: "Thrivo",
    body: tipBody,
    data: { screen: "checkin", tipId },
  }));

  const { invalidTokens } = await sendExpoPushBatch(messages);
  if (invalidTokens.length > 0) await pushTokenRepo.pruneInvalid(invalidTokens);
}

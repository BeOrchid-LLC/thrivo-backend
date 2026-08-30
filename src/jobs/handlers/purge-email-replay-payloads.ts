import type { Job } from "bullmq";
import { emailReplayPayloadRepo } from "../../repositories";
import { logger } from "../../lib/logger";

export async function handlePurgeEmailReplayPayloads(_job: Job): Promise<void> {
  const purged = await emailReplayPayloadRepo.purgeExpired();
  if (purged > 0) logger.info({ purged }, "expired email replay payloads purged");
}

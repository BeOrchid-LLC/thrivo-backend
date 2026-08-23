import type { Job } from "bullmq";
import { logger } from "../../lib/logger";
import { processNextAccountErasure } from "../../services/account-erasure.service";

export async function handleProcessAccountErasure(_job: Job): Promise<void> {
  const result = await processNextAccountErasure();
  if (result !== "none") logger.info({ result }, "account erasure worker pass complete");
}

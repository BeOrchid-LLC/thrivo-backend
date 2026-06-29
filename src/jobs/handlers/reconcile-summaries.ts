import type { Job } from "bullmq";
import { reconcileDailySummaries } from "../../services/maintenance.service";
import { logger } from "../../lib/logger";

/** Nightly backstop that heals drifted daily-summary rollups from `food_logs`. */
export async function handleReconcileSummaries(job: Job): Promise<void> {
  const { healed, sinceDate } = await reconcileDailySummaries();
  logger.info({ jobId: job.id, healed, sinceDate }, "reconcile-summaries complete");
}

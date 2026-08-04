import type { Job } from "bullmq";
import { logger } from "../../lib/logger";
import { reconcilePendingResendEvents } from "../../services/resend-webhook.service";

export async function handleReconcileResendEvents(_job: Job): Promise<void> {
  const processed = await reconcilePendingResendEvents();
  if (processed > 0) logger.info({ processed }, "pending Resend webhook events reconciled");
}

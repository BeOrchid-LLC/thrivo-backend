import type { Job } from "bullmq";
import { subscriptionRepo, userRepo } from "../../repositories";
import { logger } from "../../lib/logger";

/**
 * Backstop reconcile: flip subscriptions whose period has ended to `expired` and
 * mirror the owner back to the free tier. RevenueCat's EXPIRATION webhook is the
 * primary path; this catches anything missed (dropped webhook, downtime).
 */
export async function handleReconcileSubscriptions(_job: Job): Promise<void> {
  const expired = await subscriptionRepo.expireOverdue(new Date());

  for (const sub of expired) {
    await userRepo.updateProfile(sub.userId, { tier: "free", subscriptionStatus: "expired" });
  }

  if (expired.length > 0) logger.info({ expired: expired.length }, "subscriptions reconciled");
}

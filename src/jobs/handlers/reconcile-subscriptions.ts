import type { Job } from "bullmq";
import { subscriptionRepo, userRepo } from "../../repositories";
import { logger } from "../../lib/logger";
import { env } from "../../env";
import { syncRevenueCatSubscription } from "../../services/revenuecat.service";

/**
 * Backstop reconcile: flip subscriptions whose period has ended to `expired` and
 * mirror the owner back to the free tier. RevenueCat's EXPIRATION webhook is the
 * primary path; this catches anything missed (dropped webhook, downtime).
 */
export async function handleReconcileSubscriptions(job: Job<{ userId?: string }>): Promise<void> {
  if (env.BILLING_PROVIDER === "revenuecat") {
    if (job.data?.userId) {
      const user = await userRepo.findById(job.data.userId);
      if (user) await syncRevenueCatSubscription(user);
    } else {
      let afterId: string | null = null;
      let page: Awaited<ReturnType<typeof subscriptionRepo.listLiveForReconcile>>;
      do {
        page = await subscriptionRepo.listLiveForReconcile(100, afterId);
        for (let offset = 0; offset < page.length; offset += 5) {
          const batch = page.slice(offset, offset + 5);
          await Promise.all(
            batch.map(async (sub) => {
              const user = await userRepo.findById(sub.userId);
              if (!user) return;
              try {
                await syncRevenueCatSubscription(user);
              } catch (error) {
                logger.warn({ err: error, userId: user.id }, "RevenueCat reconciliation failed");
              }
            })
          );
        }
        afterId = page.at(-1)?.id ?? null;
      } while (page.length === 100 && afterId);
      logger.info({ reconciled: true }, "RevenueCat reconciliation fleet completed");
    }
  }
  const expired = await subscriptionRepo.expireOverdue(new Date());

  for (const sub of expired) {
    await userRepo.updateProfile(sub.userId, { tier: "free", subscriptionStatus: "expired" });
  }

  if (expired.length > 0) logger.info({ expired: expired.length }, "subscriptions reconciled");
}

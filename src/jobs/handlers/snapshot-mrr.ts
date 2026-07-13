import type { Job } from "bullmq";
import { mrrSnapshotRepo, subscriptionRepo, userRepo } from "../../repositories";
import { PLAN_PRICE_CENTS, subscriptionPlans } from "../../services/subscription.service";
import { logger } from "../../lib/logger";

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

const ANNUAL_MONTHLY_EQUIV_CENTS = Math.round(PLAN_PRICE_CENTS.annual / 12);

/**
 * Nightly MRR/subscriber snapshot — the only source of revenue *history*
 * (`subscriptions` is current-state only). Scheduled after
 * reconcile-subscriptions (03:30 UTC) so today's expirations are already
 * reflected in `subscriptions.status` before this reads it.
 */
export async function handleSnapshotMrr(_job: Job): Promise<void> {
  const now = new Date();
  const [activeByProduct, expiredToday, totalUsers] = await Promise.all([
    subscriptionRepo.countActiveByProductId(),
    subscriptionRepo.listExpiredSince(startOfUtcDay(now)),
    userRepo.countActive(),
  ]);

  const activeMonthlyCount =
    activeByProduct.find((r) => r.productId === subscriptionPlans.monthly.productId)?.count ?? 0;
  const activeAnnualCount =
    activeByProduct.find((r) => r.productId === subscriptionPlans.annual.productId)?.count ?? 0;

  const mrrCents =
    activeMonthlyCount * PLAN_PRICE_CENTS.monthly + activeAnnualCount * ANNUAL_MONTHLY_EQUIV_CENTS;

  const churnedMrrCents = expiredToday.reduce((sum, row) => {
    if (row.productId === subscriptionPlans.monthly.productId)
      return sum + PLAN_PRICE_CENTS.monthly;
    if (row.productId === subscriptionPlans.annual.productId)
      return sum + ANNUAL_MONTHLY_EQUIV_CENTS;
    return sum;
  }, 0);

  const premiumUserCount = activeMonthlyCount + activeAnnualCount;

  await mrrSnapshotRepo.upsertToday({
    snapshotDate: now.toISOString().slice(0, 10),
    mrrCents,
    activeMonthlyCount,
    activeAnnualCount,
    premiumUserCount,
    freeUserCount: Math.max(totalUsers - premiumUserCount, 0),
    churnedMrrCents,
  });

  logger.info(
    { mrrCents, activeMonthlyCount, activeAnnualCount, churnedMrrCents },
    "mrr snapshot recorded"
  );
}

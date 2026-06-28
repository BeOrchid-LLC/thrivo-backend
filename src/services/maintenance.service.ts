import { dailySummaryRepo } from "../repositories";
import { logger } from "../lib/logger";

const DEFAULT_WINDOW_DAYS = 3;

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/**
 * Recompute daily-summary rollups from their source `food_logs` for the recent
 * window and heal any that drifted from the per-mutation writer (a crash between
 * an insert and its rollup refresh, or an un-serialized concurrent write that
 * slipped through). A cheap nightly backstop — the lock in `refreshDailySummary`
 * is the primary defense; this catches what it can't. Runs off the request
 * thread on the maintenance queue.
 */
export async function reconcileDailySummaries(
  windowDays = DEFAULT_WINDOW_DAYS
): Promise<{ healed: number; sinceDate: string }> {
  const sinceDate = isoDaysAgo(windowDays);
  const healed = await dailySummaryRepo.reconcileRecentSummaries(sinceDate);
  if (healed > 0) {
    logger.warn({ healed, sinceDate }, "reconciled drifted daily summaries");
  }
  return { healed, sinceDate };
}

import { and, count, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { foodLogs, streaks, users } from "../../db/schema";
import type {
  AdminEngagementAnalytics,
  AdminSubscriptionAnalytics,
} from "../../contracts/src/admin-analytics";
import { mrrSnapshotRepo, subscriptionEventRepo } from "../repositories";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * GET /admin/analytics/subscriptions — funnel + revenue trend for the analytics
 * page. MRR/churn come from the nightly `mrr_snapshots` (the only source of MRR
 * history); trial counts from `subscription_events` over a trailing 30-day
 * window. `upgradeTriggers` stays empty until `user_events` instrumentation
 * lands (nothing writes that table yet) — an empty array, never a fake number.
 */
export async function getSubscriptionAnalytics(
  now = new Date()
): Promise<AdminSubscriptionAnalytics> {
  const thirtyDaysAgo = new Date(now.getTime() - 30 * MS_PER_DAY);

  const [latestSnapshot, monthlyTrend, eventCounts, tierCounts] = await Promise.all([
    mrrSnapshotRepo.getLatest(),
    mrrSnapshotRepo.getMonthlyTrend(6, now),
    subscriptionEventRepo.countByTypeSince(thirtyDaysAgo),
    db
      .select({ tier: users.tier, value: count() })
      .from(users)
      .where(isNull(users.deletedAt))
      .groupBy(users.tier),
  ]);

  const trendPoints = monthlyTrend.filter((p) => p.snapshot !== null);
  const freeCount = tierCounts.find((r) => r.tier === "free")?.value ?? 0;
  const premiumCount = tierCounts.find((r) => r.tier === "premium")?.value ?? 0;

  return {
    mrrCents: latestSnapshot?.mrrCents ?? 0,
    mrrTrend: trendPoints.map((p) => ({ date: p.monthEnd, value: p.snapshot!.mrrCents })),
    churnTrend: trendPoints.map((p) => ({ date: p.monthEnd, value: p.snapshot!.churnedMrrCents })),
    trialStarts: eventCounts.trial_started,
    trialConversions: eventCounts.trial_converted,
    cancellations: eventCounts.trial_cancelled,
    freeCount: Number(freeCount),
    premiumCount: Number(premiumCount),
    upgradeTriggers: [],
  };
}

/**
 * GET /admin/analytics/engagement — product-usage aggregates. Top foods and
 * average streak read the real diary/streak tables; the onboarding funnel is a
 * signup→completed collapse over `users`. `pushOpenRate` and `retention` are 0/
 * empty until the events pipeline that would feed them is instrumented — the
 * page renders those as empty states rather than fabricated figures.
 */
export async function getEngagementAnalytics(): Promise<AdminEngagementAnalytics> {
  const [signupRow, completedRow, skippedRow, topFoodRows, streakRow] = await Promise.all([
    db.select({ value: count() }).from(users).where(isNull(users.deletedAt)),
    db
      .select({ value: count() })
      .from(users)
      .where(and(isNull(users.deletedAt), isNotNull(users.onboardingCompletedAt))),
    db
      .select({ value: count() })
      .from(users)
      .where(and(isNull(users.deletedAt), eq(users.onboardingSkipped, true))),
    db
      .select({ name: foodLogs.name, value: sql<number>`count(*)::int` })
      .from(foodLogs)
      .groupBy(foodLogs.name)
      .orderBy(sql`count(*) desc`)
      .limit(10),
    db.select({ avg: sql<number | null>`avg(${streaks.currentStreak})` }).from(streaks),
  ]);

  const signups = Number(signupRow[0]?.value ?? 0);
  const completed = Number(completedRow[0]?.value ?? 0);
  const skipped = Number(skippedRow[0]?.value ?? 0);

  return {
    onboardingFunnel: [
      { step: "Signed up", count: signups },
      { step: "Completed onboarding", count: completed },
      { step: "Skipped onboarding", count: skipped },
    ],
    topFoods: topFoodRows.map((row) => ({ name: row.name, count: Number(row.value) })),
    averageStreakDays: Math.round(Number(streakRow[0]?.avg ?? 0)),
    pushOpenRate: 0,
    retention: [],
  };
}

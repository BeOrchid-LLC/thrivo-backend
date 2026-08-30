import { and, count, eq, gte, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db } from "../../db";
import { foodLogs, streaks, users } from "../../db/schema";
import type {
  AdminEngagementAnalytics,
  AdminSubscriptionAnalytics,
} from "../../contracts/src/admin-analytics";
import { mrrSnapshotRepo, subscriptionEventRepo } from "../repositories";

type DateRange = { from?: Date; to?: Date };
type AnalyticsRange = DateRange & { compareFrom?: Date; compareTo?: Date };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * GET /admin/analytics/subscriptions — funnel + revenue trend for the analytics
 * page. MRR/churn come from the nightly `mrr_snapshots` (the only source of MRR
 * history); trial counts from `subscription_events` over a trailing 30-day
 * window. `upgradeTriggers` stays empty until `user_events` instrumentation
 * lands (nothing writes that table yet) — an empty array, never a fake number.
 */
export async function getSubscriptionAnalytics(
  range?: AnalyticsRange,
  now = new Date()
): Promise<AdminSubscriptionAnalytics> {
  const thirtyDaysAgo = new Date(now.getTime() - 30 * MS_PER_DAY);
  const to = range?.to ?? now;
  const from = range?.from ?? thirtyDaysAgo;
  const [latestSnapshot, monthlyTrend, eventCounts, tierCounts] = await Promise.all([
    mrrSnapshotRepo.getLatestOnOrBefore(to),
    range?.from || range?.to
      ? mrrSnapshotRepo.getMonthlyTrendBetween(from, to)
      : mrrSnapshotRepo.getMonthlyTrend(6, now),
    subscriptionEventRepo.countByTypeInRange(from, to),
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
    comparison:
      range?.compareFrom || range?.compareTo
        ? await getSubscriptionComparison(
            range.compareFrom ?? new Date(from.getTime() - (to.getTime() - from.getTime())),
            range.compareTo ?? from
          )
        : null,
  };
}

async function getSubscriptionComparison(from: Date, to: Date) {
  const [counts, snapshot] = await Promise.all([
    subscriptionEventRepo.countByTypeInRange(from, to),
    mrrSnapshotRepo.getLatestOnOrBefore(to),
  ]);
  return {
    trialStarts: counts.trial_started,
    trialConversions: counts.trial_converted,
    cancellations: counts.trial_cancelled,
    mrrCents: snapshot?.mrrCents ?? 0,
  };
}

/**
 * GET /admin/analytics/engagement — product-usage aggregates. Top foods and
 * average streak read the real diary/streak tables; the onboarding funnel is a
 * signup→completed collapse over `users`. `pushOpenRate` and `retention` are 0/
 * empty until the events pipeline that would feed them is instrumented — the
 * page renders those as empty states rather than fabricated figures.
 */
export async function getEngagementAnalytics(
  range?: AnalyticsRange
): Promise<AdminEngagementAnalytics> {
  const foodLogsWhere =
    range?.from || range?.to
      ? and(
          range.from ? gte(foodLogs.loggedAt, range.from) : undefined,
          range.to ? lte(foodLogs.loggedAt, range.to) : undefined
        )
      : undefined;

  const [signupRow, completedRow, skippedRow, topFoodRows, streakRow] = await Promise.all([
    db
      .select({ value: count() })
      .from(users)
      .where(
        and(
          isNull(users.deletedAt),
          range?.from ? gte(users.createdAt, range.from) : undefined,
          range?.to ? lte(users.createdAt, range.to) : undefined
        )
      ),
    db
      .select({ value: count() })
      .from(users)
      .where(
        and(
          isNull(users.deletedAt),
          isNotNull(users.onboardingCompletedAt),
          range?.from ? gte(users.onboardingCompletedAt, range.from) : undefined,
          range?.to ? lte(users.onboardingCompletedAt, range.to) : undefined
        )
      ),
    db
      .select({ value: count() })
      .from(users)
      .where(
        and(
          isNull(users.deletedAt),
          eq(users.onboardingSkipped, true),
          range?.from ? gte(users.createdAt, range.from) : undefined,
          range?.to ? lte(users.createdAt, range.to) : undefined
        )
      ),
    db
      .select({ name: foodLogs.name, value: sql<number>`count(*)::int` })
      .from(foodLogs)
      .where(foodLogsWhere)
      .groupBy(foodLogs.name)
      .orderBy(sql`count(*) desc`)
      .limit(10),
    db
      .select({ avg: sql<number | null>`avg(${streaks.currentStreak})` })
      .from(streaks)
      .where(
        and(
          range?.from ? gte(streaks.updatedAt, range.from) : undefined,
          range?.to ? lte(streaks.updatedAt, range.to) : undefined
        )
      ),
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
    comparison:
      range?.compareFrom || range?.compareTo
        ? await getEngagementComparison(
            range.compareFrom ?? new Date((range.from ?? new Date()).getTime() - 30 * MS_PER_DAY),
            range.compareTo ?? range.from ?? new Date()
          )
        : null,
  };
}

async function getEngagementComparison(from: Date, to: Date) {
  const [signups, completed, skipped, streak] = await Promise.all([
    db
      .select({ value: count() })
      .from(users)
      .where(and(isNull(users.deletedAt), gte(users.createdAt, from), lte(users.createdAt, to))),
    db
      .select({ value: count() })
      .from(users)
      .where(
        and(
          isNull(users.deletedAt),
          isNotNull(users.onboardingCompletedAt),
          gte(users.onboardingCompletedAt, from),
          lte(users.onboardingCompletedAt, to)
        )
      ),
    db
      .select({ value: count() })
      .from(users)
      .where(
        and(
          isNull(users.deletedAt),
          eq(users.onboardingSkipped, true),
          gte(users.createdAt, from),
          lte(users.createdAt, to)
        )
      ),
    db
      .select({ avg: sql<number | null>`avg(${streaks.currentStreak})` })
      .from(streaks)
      .where(and(gte(streaks.updatedAt, from), lte(streaks.updatedAt, to))),
  ]);
  return {
    signups: Number(signups[0]?.value ?? 0),
    completed: Number(completed[0]?.value ?? 0),
    skipped: Number(skipped[0]?.value ?? 0),
    averageStreakDays: Math.round(Number(streak[0]?.avg ?? 0)),
  };
}

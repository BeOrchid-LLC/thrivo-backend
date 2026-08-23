import type {
  AdminOverviewMetrics,
  AdminOverviewPlanBreakdown,
  AdminOverviewRevenueTrend,
  AdminOverviewTrialPipeline,
} from "../../contracts/src/admin-analytics";
import {
  mrrSnapshotRepo,
  subscriptionEventRepo,
  subscriptionRepo,
  userRepo,
} from "../repositories";
import { PLAN_PRICE_CENTS, subscriptionPlans } from "./subscription.service";

const ANNUAL_MONTHLY_EQUIV_CENTS = Math.round(PLAN_PRICE_CENTS.annual / 12);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** `null` (not 0) when there's nothing to compare against yet — the frontend
 *  renders that as "—" rather than a misleading "+0%". */
function pctDelta(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

type ActiveByProduct = Array<{ productId: string | null; count: number }>;

function countsByPlan(activeByProduct: ActiveByProduct): { monthly: number; annual: number } {
  const monthly =
    activeByProduct.find((r) => r.productId === subscriptionPlans.monthly.productId)?.count ?? 0;
  const annual =
    activeByProduct.find((r) => r.productId === subscriptionPlans.annual.productId)?.count ?? 0;
  return { monthly, annual };
}

/** Live MRR from currently-active subscriptions — the fallback for day one,
 *  before the nightly snapshot-mrr job has ever run. */
function liveMrrCents(activeByProduct: ActiveByProduct): number {
  const { monthly, annual } = countsByPlan(activeByProduct);
  return monthly * PLAN_PRICE_CENTS.monthly + annual * ANNUAL_MONTHLY_EQUIV_CENTS;
}

/**
 * The most recently *completed* calendar month. Revenue movement (new/churned/
 * net-new MRR, churn rate) is reported against a full month rather than a
 * same-day partial current month — on the 1st of July this is June; on July
 * 15 it's still June, not July-to-date, so the number isn't a half-month
 * fragment that looks artificially small.
 */
function referenceMonthBounds(now: Date): { start: Date; end: Date } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)); // last day of previous month
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  return { start, end };
}

interface ReferenceMonthRevenue {
  startMrrCents: number | null;
  endMrrCents: number | null;
  churnedMrrCents: number;
  netNewMrrCents: number;
  newMrrCents: number;
}

async function getReferenceMonthRevenue(now: Date): Promise<ReferenceMonthRevenue> {
  const { start, end } = referenceMonthBounds(now);
  const dayBeforeStart = new Date(start.getTime() - MS_PER_DAY);
  const [snapshotBeforeMonth, snapshotMonthEnd, churnedMrrCents] = await Promise.all([
    mrrSnapshotRepo.getOnOrBefore(dayBeforeStart),
    mrrSnapshotRepo.getOnOrBefore(end),
    mrrSnapshotRepo.sumChurnedMrrBetween(toDateOnly(start), toDateOnly(end)),
  ]);
  const startMrrCents = snapshotBeforeMonth?.mrrCents ?? null;
  const endMrrCents = snapshotMonthEnd?.mrrCents ?? null;
  const netNewMrrCents = (endMrrCents ?? 0) - (startMrrCents ?? 0);
  return {
    startMrrCents,
    endMrrCents,
    churnedMrrCents,
    netNewMrrCents,
    newMrrCents: netNewMrrCents + churnedMrrCents,
  };
}
/** GET /admin/overview/metrics */
export async function getOverviewMetrics(now = new Date()): Promise<AdminOverviewMetrics> {
  const thirtyDaysAgo = new Date(now.getTime() - 30 * MS_PER_DAY);
  const oneYearAgo = new Date(now.getTime() - 365 * MS_PER_DAY);
  const dayAgo = new Date(now.getTime() - MS_PER_DAY);

  const [
    latestSnapshot,
    snapshot30dAgo,
    snapshot1yAgo,
    referenceMonth,

    activeByProduct,
    totalUsers,
    dau,
    mau,
  ] = await Promise.all([
    mrrSnapshotRepo.getLatest(),
    mrrSnapshotRepo.getOnOrBefore(thirtyDaysAgo),
    mrrSnapshotRepo.getOnOrBefore(oneYearAgo),
    getReferenceMonthRevenue(now),

    subscriptionRepo.countActiveByProductId(),
    userRepo.countActive(),
    userRepo.countActiveSince(dayAgo),
    userRepo.countActiveSince(thirtyDaysAgo),
  ]);

  const { monthly, annual } = countsByPlan(activeByProduct);
  const mrrCents = latestSnapshot?.mrrCents ?? liveMrrCents(activeByProduct);
  const arrCents = mrrCents * 12;
  const startOfMonthMrr = referenceMonth.startMrrCents ?? mrrCents;

  return {
    reportingCurrency: "USD",
    mrr: {
      cents: mrrCents,
      deltaPct: pctDelta(mrrCents, snapshot30dAgo?.mrrCents),
      label: "Estimated USD MRR",
    },
    arr: {
      cents: arrCents,
      deltaPct: pctDelta(arrCents, snapshot1yAgo ? snapshot1yAgo.mrrCents * 12 : null),
    },
    premiumUsers: { total: monthly + annual, monthly, annual },
    churnRate: {
      pct: startOfMonthMrr > 0 ? (referenceMonth.churnedMrrCents / startOfMonthMrr) * 100 : 0,
      churnedMrrCents: referenceMonth.churnedMrrCents,
    },
    dauMau: { dau, mau, totalUsers, ratioPct: mau > 0 ? (dau / mau) * 100 : 0 },
  };
}

/** GET /admin/overview/revenue-trend */
export async function getOverviewRevenueTrend(
  now = new Date()
): Promise<AdminOverviewRevenueTrend> {
  const monthlyPoints = await mrrSnapshotRepo.getMonthlyTrend(6, now);
  const trend = monthlyPoints
    .filter((p) => p.snapshot !== null)
    .map((p) => ({ date: p.monthEnd, value: p.snapshot!.mrrCents }));

  const referenceMonth = await getReferenceMonthRevenue(now);

  return {
    trend,
    newMrrCents: referenceMonth.newMrrCents,
    churnedMrrCents: referenceMonth.churnedMrrCents,
    netNewMrrCents: referenceMonth.netNewMrrCents,
  };
}

/** GET /admin/overview/trial-pipeline */
export async function getOverviewTrialPipeline(
  now = new Date()
): Promise<AdminOverviewTrialPipeline> {
  const sevenDaysAgo = new Date(now.getTime() - 7 * MS_PER_DAY);
  const counts = await subscriptionEventRepo.countByTypeSince(sevenDaysAgo);
  const { trial_started: started, trial_converted: converted, trial_cancelled: cancelled } = counts;
  const active = Math.max(started - converted - cancelled, 0);
  const denominator = started > 0 ? started : 1;

  return {
    started,
    converted,
    convertedPct: started > 0 ? (converted / denominator) * 100 : 0,
    cancelled,
    cancelledPct: started > 0 ? (cancelled / denominator) * 100 : 0,
    activePct: started > 0 ? (active / denominator) * 100 : 0,
  };
}

/** GET /admin/overview/plan-breakdown */
export async function getOverviewPlanBreakdown(): Promise<AdminOverviewPlanBreakdown> {
  const activeByProduct = await subscriptionRepo.countActiveByProductId();
  const { monthly, annual } = countsByPlan(activeByProduct);

  return {
    totalPremium: monthly + annual,
    plans: [
      {
        plan: "monthly",
        priceLabel: `${subscriptionPlans.monthly.priceLabel}/mo`,
        userCount: monthly,
        mrrCents: monthly * PLAN_PRICE_CENTS.monthly,
      },
      {
        plan: "annual",
        priceLabel: `${subscriptionPlans.annual.priceLabel}/yr`,
        userCount: annual,
        mrrCents: annual * ANNUAL_MONTHLY_EQUIV_CENTS, // MRR-equivalent, not the actual annual charge
      },
    ],
  };
}

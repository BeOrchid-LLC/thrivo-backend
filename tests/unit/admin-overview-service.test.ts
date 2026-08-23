import { afterEach, describe, expect, it, vi } from "vitest";

const {
  getLatest,
  getOnOrBefore,
  getMonthlyTrend,
  sumChurnedMrrBetween,
  countByTypeSince,
  countActiveByProductId,
  countActive,
  countActiveSince,
} = vi.hoisted(() => ({
  getLatest: vi.fn(),
  getOnOrBefore: vi.fn(),
  getMonthlyTrend: vi.fn(),
  sumChurnedMrrBetween: vi.fn(),
  countByTypeSince: vi.fn(),
  countActiveByProductId: vi.fn(),
  countActive: vi.fn(),
  countActiveSince: vi.fn(),
}));
vi.mock("../../src/repositories", () => ({
  mrrSnapshotRepo: { getLatest, getOnOrBefore, getMonthlyTrend, sumChurnedMrrBetween },
  subscriptionEventRepo: { countByTypeSince },
  subscriptionRepo: { countActiveByProductId },
  userRepo: { countActive, countActiveSince },
}));

import {
  getOverviewMetrics,
  getOverviewPlanBreakdown,
  getOverviewRevenueTrend,
  getOverviewTrialPipeline,
} from "../../src/services/admin-overview.service";

const NOW = new Date("2026-07-01T12:00:00.000Z");
const ACTIVE_BY_PRODUCT = [
  { productId: "thrivo_premium_monthly", count: 120 },
  { productId: "thrivo_premium_annual", count: 25 },
];

describe("admin-overview.service", () => {
  afterEach(() => vi.resetAllMocks());

  describe("getOverviewMetrics", () => {
    it("computes MRR/ARR deltas against 30-day/1-year-ago snapshots", async () => {
      getLatest.mockResolvedValue({ mrrCents: 220000 });
      getOnOrBefore
        .mockResolvedValueOnce({ mrrCents: 200000 }) // 30 days ago
        .mockResolvedValueOnce({ mrrCents: 100000 }) // 1 year ago
        .mockResolvedValueOnce({ mrrCents: 180000 }); // start of reference month
      sumChurnedMrrBetween.mockResolvedValue(9100);
      countActiveByProductId.mockResolvedValue(ACTIVE_BY_PRODUCT);
      countActive.mockResolvedValue(1037);
      countActiveSince.mockResolvedValueOnce(312).mockResolvedValueOnce(900);

      const metrics = await getOverviewMetrics(NOW);

      expect(metrics.reportingCurrency).toBe("USD");
      expect(metrics.mrr).toEqual({ cents: 220000, deltaPct: 10, label: "Estimated USD MRR" });
      expect(metrics.arr).toEqual({
        cents: 220000 * 12,
        deltaPct: (220000 * 12 - 1200000) / 12000,
      });
      expect(metrics.premiumUsers).toEqual({ total: 145, monthly: 120, annual: 25 });
      expect(metrics.churnRate.churnedMrrCents).toBe(9100);
      expect(metrics.churnRate.pct).toBeCloseTo((9100 / 180000) * 100);
      expect(metrics.dauMau).toEqual({
        dau: 312,
        mau: 900,
        totalUsers: 1037,
        ratioPct: (312 / 900) * 100,
      });
    });

    it("returns null deltas when there's no history to compare against yet", async () => {
      getLatest.mockResolvedValue(null);
      getOnOrBefore.mockResolvedValue(null);
      sumChurnedMrrBetween.mockResolvedValue(0);
      countActiveByProductId.mockResolvedValue([]);
      countActive.mockResolvedValue(0);
      countActiveSince.mockResolvedValue(0);

      const metrics = await getOverviewMetrics(NOW);

      expect(metrics.mrr).toEqual({ cents: 0, deltaPct: null, label: "Estimated USD MRR" });
      expect(metrics.arr).toEqual({ cents: 0, deltaPct: null });
      expect(metrics.dauMau.ratioPct).toBe(0);
      expect(metrics.churnRate.pct).toBe(0);
    });

    it("falls back to live MRR from active subscriptions when no snapshot exists yet", async () => {
      getLatest.mockResolvedValue(null);
      getOnOrBefore.mockResolvedValue(null);
      sumChurnedMrrBetween.mockResolvedValue(0);
      countActiveByProductId.mockResolvedValue(ACTIVE_BY_PRODUCT);
      countActive.mockResolvedValue(145);
      countActiveSince.mockResolvedValue(0);

      const metrics = await getOverviewMetrics(NOW);

      expect(metrics.mrr.cents).toBe(120 * 1499 + 25 * 1250);
    });
  });

  describe("getOverviewRevenueTrend", () => {
    it("derives New MRR from Net New + Churned, and filters missing history months", async () => {
      getMonthlyTrend.mockResolvedValue([
        { monthEnd: "2026-02-28", snapshot: null },
        { monthEnd: "2026-03-31", snapshot: { mrrCents: 55000 } },
        { monthEnd: "2026-06-30", snapshot: { mrrCents: 180000 } },
      ]);
      getOnOrBefore
        .mockResolvedValueOnce({ mrrCents: 180000 }) // day before ref month start
        .mockResolvedValueOnce({ mrrCents: 217400 }); // ref month end
      sumChurnedMrrBetween.mockResolvedValue(9100);

      const trend = await getOverviewRevenueTrend(NOW);

      expect(trend.trend).toEqual([
        { date: "2026-03-31", value: 55000 },
        { date: "2026-06-30", value: 180000 },
      ]);
      expect(trend.netNewMrrCents).toBe(217400 - 180000);
      expect(trend.churnedMrrCents).toBe(9100);
      expect(trend.newMrrCents).toBe(217400 - 180000 + 9100);
    });
  });

  describe("getOverviewTrialPipeline", () => {
    it("computes converted/cancelled/active percentages against started", async () => {
      countByTypeSince.mockResolvedValue({
        trial_started: 38,
        trial_converted: 23,
        trial_cancelled: 10,
        renewed: 0,
        expired: 0,
      });

      const pipeline = await getOverviewTrialPipeline(NOW);

      expect(pipeline).toEqual({
        started: 38,
        converted: 23,
        convertedPct: (23 / 38) * 100,
        cancelled: 10,
        cancelledPct: (10 / 38) * 100,
        activePct: (5 / 38) * 100,
      });
    });

    it("reads all zero-percent, not NaN, when no trials started in the window", async () => {
      countByTypeSince.mockResolvedValue({
        trial_started: 0,
        trial_converted: 0,
        trial_cancelled: 0,
        renewed: 0,
        expired: 0,
      });

      const pipeline = await getOverviewTrialPipeline(NOW);

      expect(pipeline).toEqual({
        started: 0,
        converted: 0,
        convertedPct: 0,
        cancelled: 0,
        cancelledPct: 0,
        activePct: 0,
      });
    });

    it("never reports a negative active percentage if cancelled+converted somehow exceeds started", async () => {
      countByTypeSince.mockResolvedValue({
        trial_started: 5,
        trial_converted: 4,
        trial_cancelled: 4,
        renewed: 0,
        expired: 0,
      });

      const pipeline = await getOverviewTrialPipeline(NOW);

      expect(pipeline.activePct).toBe(0);
    });
  });

  describe("getOverviewPlanBreakdown", () => {
    it("splits monthly vs annual with amortized MRR-equivalent for annual", async () => {
      countActiveByProductId.mockResolvedValue(ACTIVE_BY_PRODUCT);

      const breakdown = await getOverviewPlanBreakdown();

      expect(breakdown.totalPremium).toBe(145);
      expect(breakdown.plans).toEqual([
        { plan: "monthly", priceLabel: "$14.99/mo", userCount: 120, mrrCents: 120 * 1499 },
        { plan: "annual", priceLabel: "$150/yr", userCount: 25, mrrCents: 25 * 1250 },
      ]);
    });
  });
});

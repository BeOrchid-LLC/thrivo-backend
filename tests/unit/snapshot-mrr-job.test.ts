import { afterEach, describe, expect, it, vi } from "vitest";

const { countActiveByProductId, listExpiredSince, countActive, upsertToday } = vi.hoisted(() => ({
  countActiveByProductId: vi.fn(),
  listExpiredSince: vi.fn(),
  countActive: vi.fn(),
  upsertToday: vi.fn(),
}));
vi.mock("../../src/repositories", () => ({
  subscriptionRepo: { countActiveByProductId, listExpiredSince },
  userRepo: { countActive },
  mrrSnapshotRepo: { upsertToday },
}));

import { handleSnapshotMrr } from "../../src/jobs/handlers/snapshot-mrr";

describe("snapshot-mrr job", () => {
  afterEach(() => vi.resetAllMocks());

  it("computes MRR from active monthly + annual counts (annual amortized monthly)", async () => {
    countActiveByProductId.mockResolvedValue([
      { productId: "thrivo_premium_monthly", count: 120 },
      { productId: "thrivo_premium_annual", count: 25 },
    ]);
    listExpiredSince.mockResolvedValue([]);
    countActive.mockResolvedValue(1037);

    await handleSnapshotMrr({} as never);

    expect(upsertToday).toHaveBeenCalledTimes(1);
    const snapshot = upsertToday.mock.calls[0][0];
    // 120 * $14.99 + 25 * ($150/12) = 1798.80 + 312.5 → rounded per-plan first.
    expect(snapshot.mrrCents).toBe(120 * 1499 + 25 * 1250);
    expect(snapshot.activeMonthlyCount).toBe(120);
    expect(snapshot.activeAnnualCount).toBe(25);
    expect(snapshot.premiumUserCount).toBe(145);
    expect(snapshot.freeUserCount).toBe(1037 - 145);
    expect(snapshot.churnedMrrCents).toBe(0);
  });

  it("attributes churned MRR to today's expirations by plan", async () => {
    countActiveByProductId.mockResolvedValue([{ productId: "thrivo_premium_monthly", count: 10 }]);
    listExpiredSince.mockResolvedValue([
      { productId: "thrivo_premium_monthly" },
      { productId: "thrivo_premium_annual" },
    ]);
    countActive.mockResolvedValue(50);

    await handleSnapshotMrr({} as never);

    const snapshot = upsertToday.mock.calls[0][0];
    expect(snapshot.churnedMrrCents).toBe(1499 + 1250);
  });

  it("never lets freeUserCount go negative if premium somehow exceeds total", async () => {
    countActiveByProductId.mockResolvedValue([{ productId: "thrivo_premium_monthly", count: 10 }]);
    listExpiredSince.mockResolvedValue([]);
    countActive.mockResolvedValue(5); // fewer total users than the "active" count (stale data)

    await handleSnapshotMrr({} as never);

    const snapshot = upsertToday.mock.calls[0][0];
    expect(snapshot.freeUserCount).toBe(0);
  });
});

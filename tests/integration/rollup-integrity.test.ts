import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";
import { dailySummaryRepo, foodLogRepo } from "../../src/repositories";
import { logEstimate, deleteFoodLog } from "../../src/services/food.service";
import { reconcileDailySummaries } from "../../src/services/maintenance.service";
import type { LogEstimatePayload } from "../../contracts/src/foods";

// Integration suite — real test Postgres, gated by RUN_DB_TESTS=1.
const run = process.env.RUN_DB_TESTS === "1";

const DAY = "2026-06-15";

function estimatePayload(overrides: Partial<LogEstimatePayload> = {}): LogEstimatePayload {
  return {
    name: "Jollof rice",
    portionMeasure: "serving",
    quantity: 1,
    day: DAY,
    nutrients: { calories: 100, proteinG: 5, carbsG: 12, fatG: 3 },
    ...overrides,
  };
}

describe.skipIf(!run)("integration: rollup integrity", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeDb();
  });

  // The regression guard: without the per-(user, day) advisory lock in
  // refreshDailySummary, concurrent writers each read an absolute total that
  // misses the other's uncommitted row and the rollup silently drops entries.
  it("keeps daily_summaries consistent under concurrent same-day writes", async () => {
    const user = await makeUser();
    const concurrentWrites = 8;

    await Promise.all(
      Array.from({ length: concurrentWrites }, () => logEstimate(user, estimatePayload()))
    );

    const summary = await dailySummaryRepo.getForDay(user.id, DAY);
    const live = await foodLogRepo.totalsForDay(user.id, DAY);

    expect(live.calories).toBe(concurrentWrites * 100);
    expect(summary?.totalCalories).toBe(live.calories);
    expect(Number(summary?.totalProteinG)).toBe(live.proteinG);
    expect(Number(summary?.totalCarbsG)).toBe(live.carbsG);
    expect(Number(summary?.totalFatG)).toBe(live.fatG);
  });

  it("stays correct when a same-day entry is deleted", async () => {
    const user = await makeUser();
    const [first] = await Promise.all([
      logEstimate(
        user,
        estimatePayload({ nutrients: { calories: 100, proteinG: 1, carbsG: 1, fatG: 1 } })
      ),
      logEstimate(
        user,
        estimatePayload({ nutrients: { calories: 200, proteinG: 2, carbsG: 2, fatG: 2 } })
      ),
    ]);

    await deleteFoodLog(user, first.entry.id);

    const summary = await dailySummaryRepo.getForDay(user.id, DAY);
    const live = await foodLogRepo.totalsForDay(user.id, DAY);
    expect(summary?.totalCalories).toBe(live.calories);
    expect(summary?.totalCalories).toBe(200);
  });

  it("reconcile heals a summary that drifted from food_logs", async () => {
    const user = await makeUser();
    await logEstimate(
      user,
      estimatePayload({ nutrients: { calories: 250, proteinG: 10, carbsG: 30, fatG: 8 } })
    );

    // Corrupt the rollup behind the service's back to simulate drift.
    await dailySummaryRepo.upsertForDay({
      userId: user.id,
      localDate: DAY,
      totalCalories: 9999,
      totalProteinG: "999",
      totalCarbsG: "999",
      totalFatG: "999",
      calorieTarget: 1800,
    });

    // Wide window so the heal is deterministic regardless of the fixed test date.
    const { healed } = await reconcileDailySummaries(100_000);
    expect(healed).toBe(1);

    const summary = await dailySummaryRepo.getForDay(user.id, DAY);
    const live = await foodLogRepo.totalsForDay(user.id, DAY);
    expect(summary?.totalCalories).toBe(live.calories);
    expect(summary?.totalCalories).toBe(250);
  });
});

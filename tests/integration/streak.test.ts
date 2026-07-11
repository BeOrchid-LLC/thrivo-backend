import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";
import { streakRepo } from "../../src/repositories";
import { logEstimate } from "../../src/services/food.service";
import type { LogEstimatePayload } from "../../contracts/src/foods";

// Integration suite — real test Postgres, gated by RUN_DB_TESTS=1.
const run = process.env.RUN_DB_TESTS === "1";

function estimatePayload(day: string): LogEstimatePayload {
  return {
    name: "Egusi soup",
    portionMeasure: "serving",
    quantity: 1,
    day,
    nutrients: { calories: 300, proteinG: 12, carbsG: 20, fatG: 18 },
  };
}

describe.skipIf(!run)("integration: streak computation (R4-3 / I11)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeDb();
  });

  it("advances currentStreakDays by 1 per consecutive local day logged", async () => {
    const user = await makeUser();
    for (const day of ["2026-07-01", "2026-07-02", "2026-07-03"]) {
      await logEstimate(user, estimatePayload(day), `key-${day}`);
    }
    const streak = await streakRepo.getByUser(user.id);
    expect(streak?.currentStreak).toBe(3);
    expect(streak?.longestStreak).toBe(3);
    expect(streak?.lastLoggedDate).toBe("2026-07-03");
  });

  it("is idempotent under retry — two logs on the same day advance the streak once", async () => {
    const user = await makeUser();
    await logEstimate(user, estimatePayload("2026-07-01"), "a");
    await logEstimate(user, estimatePayload("2026-07-01"), "b");

    const streak = await streakRepo.getByUser(user.id);
    expect(streak?.currentStreak).toBe(1);
  });

  it("resets currentStreak after a skipped day but keeps the prior longestStreak", async () => {
    const user = await makeUser();
    for (const day of ["2026-07-01", "2026-07-02", "2026-07-03"]) {
      await logEstimate(user, estimatePayload(day), `key-${day}`);
    }
    // 2026-07-04 skipped entirely.
    await logEstimate(user, estimatePayload("2026-07-05"), "key-2026-07-05");

    const streak = await streakRepo.getByUser(user.id);
    expect(streak?.currentStreak).toBe(1);
    expect(streak?.longestStreak).toBe(3);
    expect(streak?.lastLoggedDate).toBe("2026-07-05");
  });

  it("does not double-count multiple logs within the same qualifying day", async () => {
    const user = await makeUser();
    await logEstimate(user, estimatePayload("2026-07-01"), "first");
    await logEstimate(user, { ...estimatePayload("2026-07-01"), name: "Jollof rice" }, "second");
    await logEstimate(user, { ...estimatePayload("2026-07-01"), name: "Plantain" }, "third");

    const streak = await streakRepo.getByUser(user.id);
    expect(streak?.currentStreak).toBe(1);
  });
});

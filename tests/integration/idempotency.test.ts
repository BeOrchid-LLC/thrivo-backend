import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";
import { foodLogRepo, waterIntakeRepo } from "../../src/repositories";
import { logEstimate } from "../../src/services/food.service";
import { saveWater } from "../../src/services/metrics.service";
import type { LogEstimatePayload } from "../../contracts/src/foods";

// Integration suite — real test Postgres, gated by RUN_DB_TESTS=1.
const run = process.env.RUN_DB_TESTS === "1";

const DAY = "2026-06-16";

function estimatePayload(): LogEstimatePayload {
  return {
    name: "Egusi soup",
    portionMeasure: "serving",
    quantity: 1,
    day: DAY,
    nutrients: { calories: 300, proteinG: 12, carbsG: 20, fatG: 18 },
  };
}

describe.skipIf(!run)("integration: write idempotency", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeDb();
  });

  it("dedupes a replayed food log by idempotency key", async () => {
    const user = await makeUser();
    const first = await logEstimate(user, estimatePayload(), "key-1");
    const replay = await logEstimate(user, estimatePayload(), "key-1");

    // Same row returned, not a duplicate, and the total isn't double-counted.
    expect(replay.entry.id).toBe(first.entry.id);
    const logs = await foodLogRepo.listLogsForDay(user.id, DAY);
    expect(logs).toHaveLength(1);
    expect(replay.totals.calories).toBe(300);
  });

  it("treats distinct keys and null keys as separate writes", async () => {
    const user = await makeUser();
    await logEstimate(user, estimatePayload(), "key-1");
    await logEstimate(user, estimatePayload(), "key-2");
    await logEstimate(user, estimatePayload()); // no key — always inserts
    await logEstimate(user, estimatePayload()); // no key — always inserts

    const logs = await foodLogRepo.listLogsForDay(user.id, DAY);
    expect(logs).toHaveLength(4);
  });

  it("dedupes a replayed water entry by idempotency key", async () => {
    const user = await makeUser();
    await saveWater(user, DAY, 250, "water-key-1");
    await saveWater(user, DAY, 250, "water-key-1");

    const entries = await waterIntakeRepo.listEntriesForDay(user.id, DAY);
    expect(entries).toHaveLength(1);
    expect(await waterIntakeRepo.getDayTotal(user.id, DAY)).toBe(250);
  });
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";
import { foodItemRepo } from "../../src/repositories";
import { logEstimate, searchFoods } from "../../src/services/food.service";
import type { LogEstimatePayload } from "../../contracts/src/foods";

const run = process.env.RUN_DB_TESTS === "1";

function estimatePayload(overrides: Partial<LogEstimatePayload> = {}): LogEstimatePayload {
  return {
    name: "Chicken suya",
    portionMeasure: "serving",
    quantity: 1,
    day: "2026-07-16",
    nutrients: { calories: 270, proteinG: 28, carbsG: 8, fatG: 12 },
    servingUnit: "serving",
    ...overrides,
  };
}

describe.skipIf(!run)("integration: logEstimate creates personal catalog item", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeDb();
  });

  it("attaches a personal estimate foodItemId and keeps isEstimated true", async () => {
    const user = await makeUser();
    const result = await logEstimate(user, estimatePayload(), "est-1");

    expect(result.entry.foodItemId).toBeTruthy();
    expect(result.entry.isEstimated).toBe(true);
    expect(result.entry.source).toBe("manual");

    const item = await foodItemRepo.findById(result.entry.foodItemId!);
    expect(item?.tier).toBe("personal");
    expect(item?.ownerUserId).toBe(user.id);
    expect(item?.originRef).toBe("estimate");

    const mapped = await searchFoods(user, "suya", 10);
    expect(mapped.phase).toBe("local");
    expect(mapped.items.some((entry) => entry.id === result.entry.foodItemId)).toBe(true);
    expect(mapped.items.find((entry) => entry.id === result.entry.foodItemId)?.isEstimated).toBe(
      true
    );
  });

  it("reuses the same personal estimate item for the same name", async () => {
    const user = await makeUser();
    const first = await logEstimate(user, estimatePayload(), "est-a");
    const second = await logEstimate(user, estimatePayload({ day: "2026-07-17" }), "est-b");

    expect(second.entry.foodItemId).toBe(first.entry.foodItemId);
  });
});

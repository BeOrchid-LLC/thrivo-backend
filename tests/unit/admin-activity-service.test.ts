import { afterEach, describe, expect, it, vi } from "vitest";

const { listRecentLogs, countByUserId: countFoodLogs } = vi.hoisted(() => ({
  listRecentLogs: vi.fn(),
  countByUserId: vi.fn(),
}));
const { listForUser, countByUserId: countCheckIns } = vi.hoisted(() => ({
  listForUser: vi.fn(),
  countByUserId: vi.fn(),
}));
const { listRecentByUser, countByUserId: countWeightEntries } = vi.hoisted(() => ({
  listRecentByUser: vi.fn(),
  countByUserId: vi.fn(),
}));

vi.mock("../../src/repositories", () => ({
  foodLogRepo: { listRecentLogs, countByUserId: countFoodLogs },
  checkInRepo: { listForUser, countByUserId: countCheckIns },
  weightEntryRepo: { listRecentByUser, countByUserId: countWeightEntries },
}));

import { getUserActivity } from "../../src/services/admin-activity.service";

describe("admin-activity.service", () => {
  afterEach(() => vi.resetAllMocks());

  it("maps food_logs rows, defaulting the limit and dropping the meal field entirely", async () => {
    listRecentLogs.mockResolvedValue([
      {
        id: "f1",
        name: "Oats with banana",
        localDate: "2026-06-30",
        servingQty: "1",
        servingUnit: "serving",
        kcal: 380,
      },
    ]);
    countFoodLogs.mockResolvedValue(124);

    const page = await getUserActivity("u1", "food_logs");

    expect(listRecentLogs).toHaveBeenCalledWith("u1", 10);
    expect(page).toEqual({
      items: [
        {
          id: "f1",
          name: "Oats with banana",
          localDate: "2026-06-30",
          servingQty: 1,
          servingUnit: "serving",
          kcal: 380,
        },
      ],
      total: 124,
      limit: 10,
    });
  });

  it("clamps an out-of-range limit for check_ins", async () => {
    listForUser.mockResolvedValue([]);
    countCheckIns.mockResolvedValue(0);

    await getUserActivity("u1", "check_ins", 500);

    expect(listForUser).toHaveBeenCalledWith("u1", 50);
  });

  it("maps weight_logs rows, coercing the numeric weight column to a number", async () => {
    listRecentByUser.mockResolvedValue([
      { id: "w1", localDate: "2026-06-30", weightKg: "72.4", note: null },
    ]);
    countWeightEntries.mockResolvedValue(8);

    const page = await getUserActivity("u1", "weight_logs", 5);

    expect(page.items).toEqual([{ id: "w1", localDate: "2026-06-30", weightKg: 72.4, note: null }]);
    expect(page.limit).toBe(5);
  });

  it("maps check_ins rows as-is (mood/note pass through)", async () => {
    listForUser.mockResolvedValue([
      { id: "c1", localDate: "2026-06-30", mood: "good", note: "felt fine" },
    ]);
    countCheckIns.mockResolvedValue(15);

    const page = await getUserActivity("u1", "check_ins");

    expect(page.items).toEqual([
      { id: "c1", localDate: "2026-06-30", mood: "good", note: "felt fine" },
    ]);
    expect(page.total).toBe(15);
  });
});

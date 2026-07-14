import { afterEach, describe, expect, it, vi } from "vitest";

const { listRange, getForDay, listForWeeklyReview } = vi.hoisted(() => ({
  listRange: vi.fn(),
  getForDay: vi.fn(),
  listForWeeklyReview: vi.fn(),
}));
vi.mock("../../src/repositories", () => ({
  dailySummaryRepo: { listRange, getForDay, listForWeeklyReview },
}));

import {
  getWeeklyReviewBatch,
  getWeeklyReviewStats,
  hasLoggedToday,
} from "../../src/services/weekly-review.service";

describe("weekly-review.service", () => {
  afterEach(() => vi.clearAllMocks());

  it("batches the rolling windows and skips zones unsupported by the runtime", async () => {
    listForWeeklyReview.mockResolvedValue([
      { userId: "u1", localDate: "2024-01-15" },
      { userId: "u1", localDate: "2024-01-10" },
      { userId: "u1", localDate: "2024-01-08" },
    ]);

    const result = await getWeeklyReviewBatch(
      [
        { id: "u1", timezone: "America/New_York" },
        { id: "u2", timezone: "not-a-real-zone" },
      ],
      new Date("2024-01-15T09:00:00Z")
    );

    expect(listForWeeklyReview).toHaveBeenCalledWith([
      { userId: "u1", lastWeekStart: "2024-01-02", today: "2024-01-15" },
    ]);
    expect(result.skippedUnsupportedTimezone).toBe(1);
    expect(result.byUserId.get("u1")).toEqual({
      asOfLocalDate: "2024-01-15",
      loggedToday: true,
      loggedThisWeek: 2,
      loggedLastWeek: 1,
    });
    expect(result.byUserId.has("u2")).toBe(false);
  });
  it("computes rolling 7-day windows for this week and last week, ending on the user's local today", async () => {
    listRange.mockImplementation((_userId: string, from: string, to: string) => {
      // This-week window.
      if (from === "2024-01-09" && to === "2024-01-15") {
        return Promise.resolve([{ localDate: "2024-01-10" }, { localDate: "2024-01-12" }]);
      }
      // Last-week window.
      if (from === "2024-01-02" && to === "2024-01-08") {
        return Promise.resolve(
          Array.from({ length: 5 }, (_, i) => ({ localDate: `2024-01-0${i + 2}` }))
        );
      }
      throw new Error(`unexpected range ${from}..${to}`);
    });

    const stats = await getWeeklyReviewStats("u1", "UTC", new Date("2024-01-15T09:00:00Z"));

    expect(stats.asOfLocalDate).toBe("2024-01-15");
    expect(stats.loggedThisWeek).toBe(2);
    expect(stats.loggedLastWeek).toBe(5);
  });

  it("hasLoggedToday reflects whether a daily_summaries row exists for the user's local today", async () => {
    getForDay.mockResolvedValueOnce({ userId: "u1", localDate: "2024-01-15" });
    await expect(hasLoggedToday("u1", "UTC", new Date("2024-01-15T09:00:00Z"))).resolves.toBe(true);

    getForDay.mockResolvedValueOnce(null);
    await expect(hasLoggedToday("u1", "UTC", new Date("2024-01-15T09:00:00Z"))).resolves.toBe(
      false
    );
  });
});

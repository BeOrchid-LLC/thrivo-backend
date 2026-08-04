import { afterEach, describe, expect, it, vi } from "vitest";

const { listDistinctDatesForWeeklyReview } = vi.hoisted(() => ({
  listDistinctDatesForWeeklyReview: vi.fn(),
}));
vi.mock("../../src/repositories", () => ({
  foodLogRepo: { listDistinctDatesForWeeklyReview },
}));

import { getWeeklyReviewBatch } from "../../src/services/weekly-review.service";

describe("weekly-review.service", () => {
  afterEach(() => vi.clearAllMocks());

  it("reviews the completed Sunday-Saturday period and excludes the sending Sunday", async () => {
    listDistinctDatesForWeeklyReview.mockResolvedValue([
      { userId: "u1", localDate: "2024-01-14" },
      { userId: "u1", localDate: "2024-01-20" },
      { userId: "u1", localDate: "2024-01-21" },
      { userId: "u1", localDate: "2024-01-13" },
    ]);

    const result = await getWeeklyReviewBatch(
      [{ id: "u1", timezone: "UTC", createdAt: new Date("2023-12-01T12:00:00Z") }],
      new Date("2024-01-21T09:00:00Z")
    );

    expect(listDistinctDatesForWeeklyReview).toHaveBeenCalledWith([
      { userId: "u1", fromDate: "2024-01-07", toDate: "2024-01-20" },
    ]);
    expect(result.byUserId.get("u1")).toEqual({
      sendLocalDate: "2024-01-21",
      periodStart: "2024-01-14",
      periodEnd: "2024-01-20",
      loggedDays: 2,
      previousLoggedDays: 1,
      includeComparison: true,
      joinedDuringPeriod: false,
    });
  });

  it("omits comparison and uses join-aware wording metadata for a part-week user", async () => {
    listDistinctDatesForWeeklyReview.mockResolvedValue([]);

    const result = await getWeeklyReviewBatch(
      [{ id: "u1", timezone: "UTC", createdAt: new Date("2024-01-17T12:00:00Z") }],
      new Date("2024-01-21T09:00:00Z")
    );

    expect(result.byUserId.get("u1")).toMatchObject({
      periodStart: "2024-01-14",
      periodEnd: "2024-01-20",
      includeComparison: false,
      joinedDuringPeriod: true,
    });
  });

  it("quarantines unsupported timezones instead of silently treating them as UTC", async () => {
    listDistinctDatesForWeeklyReview.mockResolvedValue([]);

    const result = await getWeeklyReviewBatch(
      [
        { id: "u1", timezone: "not-a-real-zone", createdAt: new Date("2024-01-01T00:00:00Z") },
        { id: "u2", timezone: null, createdAt: new Date("2024-01-01T00:00:00Z") },
      ],
      new Date("2024-01-21T09:00:00Z")
    );

    expect(result.skippedUnsupportedTimezone).toBe(1);
    expect(result.byUserId.has("u1")).toBe(false);
    expect(result.byUserId.has("u2")).toBe(true);
  });
});

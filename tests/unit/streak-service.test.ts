import { describe, expect, it } from "vitest";
import {
  computeNextStreak,
  foldStreakFromLocalDates,
  EMPTY_STREAK_STATE,
  type StreakState,
} from "../../src/services/streak.service";

describe("computeNextStreak (I11 / R4-3)", () => {
  it("starts a fresh streak at 1 on the first-ever qualifying day", () => {
    const next = computeNextStreak(EMPTY_STREAK_STATE, "2026-07-01");
    expect(next).toEqual({ currentStreak: 1, longestStreak: 1, lastLoggedDate: "2026-07-01" });
  });

  it("increments on the very next consecutive local day", () => {
    let state: StreakState = EMPTY_STREAK_STATE;
    for (const day of ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04"]) {
      state = computeNextStreak(state, day);
    }
    expect(state.currentStreak).toBe(4);
    expect(state.longestStreak).toBe(4);
    expect(state.lastLoggedDate).toBe("2026-07-04");
  });

  it("is idempotent — replaying the same day twice advances the streak once", () => {
    const once = computeNextStreak(EMPTY_STREAK_STATE, "2026-07-01");
    const replay = computeNextStreak(once, "2026-07-01");
    expect(replay).toEqual(once);
  });

  it("resets currentStreak to 1 after a skipped day, but preserves longestStreak", () => {
    let state = foldStreakFromLocalDates(["2026-07-01", "2026-07-02", "2026-07-03"]);
    expect(state.currentStreak).toBe(3);
    expect(state.longestStreak).toBe(3);

    // 2026-07-04 skipped — next log is 2026-07-05, a 2-day gap.
    state = computeNextStreak(state, "2026-07-05");
    expect(state.currentStreak).toBe(1);
    expect(state.longestStreak).toBe(3); // the prior best is not erased
    expect(state.lastLoggedDate).toBe("2026-07-05");
  });

  it("does not double-count or move lastLoggedDate backward for a backdated/out-of-order day", () => {
    const state = computeNextStreak(
      { currentStreak: 5, longestStreak: 5, lastLoggedDate: "2026-07-10" },
      "2026-07-05" // an older day logged after a more recent one — already covered
    );
    expect(state).toEqual({ currentStreak: 5, longestStreak: 5, lastLoggedDate: "2026-07-10" });
  });

  it("holds across a month boundary (consecutive local days, not same-month check)", () => {
    const state = computeNextStreak(
      { currentStreak: 2, longestStreak: 2, lastLoggedDate: "2026-06-30" },
      "2026-07-01"
    );
    expect(state).toEqual({ currentStreak: 3, longestStreak: 3, lastLoggedDate: "2026-07-01" });
  });

  it("a longer historical run raises longestStreak above a shorter current run", () => {
    // 5-day run, 1-day gap, then a fresh 2-day run — longest should stay 5.
    const state = foldStreakFromLocalDates([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
      "2026-07-05",
      // 07-06 skipped
      "2026-07-07",
      "2026-07-08",
    ]);
    expect(state.currentStreak).toBe(2);
    expect(state.longestStreak).toBe(5);
    expect(state.lastLoggedDate).toBe("2026-07-08");
  });
});

describe("foldStreakFromLocalDates (backfill core)", () => {
  it("returns the empty state for a user with no qualifying days", () => {
    expect(foldStreakFromLocalDates([])).toEqual(EMPTY_STREAK_STATE);
  });

  it("matches sequential computeNextStreak calls over the same dates", () => {
    const dates = ["2026-01-01", "2026-01-02", "2026-01-04", "2026-01-05", "2026-01-06"];
    const folded = foldStreakFromLocalDates(dates);
    const sequential = dates.reduce(computeNextStreak, EMPTY_STREAK_STATE);
    expect(folded).toEqual(sequential);
  });
});

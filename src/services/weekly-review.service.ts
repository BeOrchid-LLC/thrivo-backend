import { dailySummaryRepo } from "../repositories";
import { localDateFor, shiftLocalDate, tryLocalDateFor } from "../lib/local-date";

const WEEK_DAYS = 7;

export interface WeeklyReviewCandidateInput {
  id: string;
  timezone: string | null;
}

export interface WeeklyReviewBatchItem extends WeeklyReviewStats {
  loggedToday: boolean;
}

export interface WeeklyReviewBatchResult {
  byUserId: Map<string, WeeklyReviewBatchItem>;
  skippedUnsupportedTimezone: number;
}

export interface WeeklyReviewStats {
  /** The user's local day the stats are computed as of. */
  asOfLocalDate: string;
  /** Distinct days logged in the rolling 7-day window ending today (0-7). */
  loggedThisWeek: number;
  /** Distinct days logged in the 7-day window immediately before that (0-7). */
  loggedLastWeek: number;
}

/** Load all weekly-review gates and rolling windows for a page in one query. */
export async function getWeeklyReviewBatch(
  candidates: WeeklyReviewCandidateInput[],
  at: Date = new Date()
): Promise<WeeklyReviewBatchResult> {
  const windows = candidates.flatMap((candidate) => {
    const today = tryLocalDateFor(candidate.timezone, at);
    if (!today) return [];
    const thisWeekStart = shiftLocalDate(today, -(WEEK_DAYS - 1));
    const lastWeekEnd = shiftLocalDate(thisWeekStart, -1);
    const lastWeekStart = shiftLocalDate(lastWeekEnd, -(WEEK_DAYS - 1));
    return [{ candidate, today, thisWeekStart, lastWeekStart, lastWeekEnd }];
  });

  const rows = await dailySummaryRepo.listForWeeklyReview(
    windows.map(({ candidate, today, lastWeekStart }) => ({
      userId: candidate.id,
      lastWeekStart,
      today,
    }))
  );
  const datesByUserId = new Map<string, string[]>();
  for (const row of rows) {
    const dates = datesByUserId.get(row.userId) ?? [];
    dates.push(row.localDate);
    datesByUserId.set(row.userId, dates);
  }

  const byUserId = new Map<string, WeeklyReviewBatchItem>();
  for (const { candidate, today, thisWeekStart, lastWeekStart, lastWeekEnd } of windows) {
    const dates = datesByUserId.get(candidate.id) ?? [];
    byUserId.set(candidate.id, {
      asOfLocalDate: today,
      loggedToday: dates.includes(today),
      loggedThisWeek: dates.filter((date) => date >= thisWeekStart && date <= today).length,
      loggedLastWeek: dates.filter((date) => date >= lastWeekStart && date <= lastWeekEnd).length,
    });
  }

  return {
    byUserId,
    skippedUnsupportedTimezone: candidates.length - windows.length,
  };
}

/**
 * Rolling 7-day windows, not calendar weeks — a calendar week (Mon-Sun) would
 * make "N of 7" degenerate to "0 of 0" every Monday. This mirrors how
 * streak.service already thinks about logged days: consecutive-day-based,
 * not calendar-based.
 *
 * Called only after confirming the user hasn't logged their local "today"
 * (see hasLoggedToday) — today's row won't exist yet, so it correctly
 * contributes 0 without any special-casing here.
 */
export async function getWeeklyReviewStats(
  userId: string,
  timezone: string | null,
  at: Date = new Date()
): Promise<WeeklyReviewStats> {
  const today = localDateFor(timezone, at);
  const thisWeekStart = shiftLocalDate(today, -(WEEK_DAYS - 1));
  const lastWeekEnd = shiftLocalDate(thisWeekStart, -1);
  const lastWeekStart = shiftLocalDate(lastWeekEnd, -(WEEK_DAYS - 1));

  const [thisWeek, lastWeek] = await Promise.all([
    dailySummaryRepo.listRange(userId, thisWeekStart, today),
    dailySummaryRepo.listRange(userId, lastWeekStart, lastWeekEnd),
  ]);

  return {
    asOfLocalDate: today,
    loggedThisWeek: thisWeek.length,
    loggedLastWeek: lastWeek.length,
  };
}

/** Has the user already logged on their local "today"? Gates the weekly-review nudge — no email once they have. */
export async function hasLoggedToday(
  userId: string,
  timezone: string | null,
  at: Date = new Date()
): Promise<boolean> {
  const today = localDateFor(timezone, at);
  const row = await dailySummaryRepo.getForDay(userId, today);
  return row !== null;
}

import { foodLogRepo } from "../repositories";
import { shiftLocalDate, tryLocalDateFor } from "../lib/local-date";

export interface WeeklyReviewCandidateInput {
  id: string;
  timezone: string | null;
  createdAt: Date;
}

export interface WeeklyReviewStats {
  sendLocalDate: string;
  periodStart: string;
  periodEnd: string;
  loggedDays: number;
  previousLoggedDays: number;
  includeComparison: boolean;
  joinedDuringPeriod: boolean;
}

export interface WeeklyReviewBatchResult {
  byUserId: Map<string, WeeklyReviewStats>;
  skippedUnsupportedTimezone: number;
}

/** Completed local Sunday-Saturday periods; the current sending Sunday is excluded. */
export async function getWeeklyReviewBatch(
  candidates: WeeklyReviewCandidateInput[],
  at: Date = new Date()
): Promise<WeeklyReviewBatchResult> {
  const windows = candidates.flatMap((candidate) => {
    const sendLocalDate = tryLocalDateFor(candidate.timezone, at);
    const createdLocalDate = tryLocalDateFor(candidate.timezone, candidate.createdAt);
    if (!sendLocalDate || !createdLocalDate) return [];
    const periodEnd = shiftLocalDate(sendLocalDate, -1);
    const periodStart = shiftLocalDate(sendLocalDate, -7);
    const previousEnd = shiftLocalDate(sendLocalDate, -8);
    const previousStart = shiftLocalDate(sendLocalDate, -14);
    return [
      {
        candidate,
        sendLocalDate,
        createdLocalDate,
        periodStart,
        periodEnd,
        previousStart,
        previousEnd,
      },
    ];
  });

  const rows = await foodLogRepo.listDistinctDatesForWeeklyReview(
    windows.map(({ candidate, previousStart, periodEnd }) => ({
      userId: candidate.id,
      fromDate: previousStart,
      toDate: periodEnd,
    }))
  );
  const datesByUser = new Map<string, string[]>();
  for (const row of rows) {
    const dates = datesByUser.get(row.userId) ?? [];
    dates.push(row.localDate);
    datesByUser.set(row.userId, dates);
  }

  const byUserId = new Map<string, WeeklyReviewStats>();
  for (const window of windows) {
    const dates = datesByUser.get(window.candidate.id) ?? [];
    byUserId.set(window.candidate.id, {
      sendLocalDate: window.sendLocalDate,
      periodStart: window.periodStart,
      periodEnd: window.periodEnd,
      loggedDays: dates.filter((date) => date >= window.periodStart && date <= window.periodEnd)
        .length,
      previousLoggedDays: dates.filter(
        (date) => date >= window.previousStart && date <= window.previousEnd
      ).length,
      includeComparison: window.createdLocalDate <= window.previousStart,
      joinedDuringPeriod: window.createdLocalDate > window.periodStart,
    });
  }

  return { byUserId, skippedUnsupportedTimezone: candidates.length - windows.length };
}

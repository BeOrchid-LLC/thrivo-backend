import type { Executor } from "../../db/tx";
import { streakRepo } from "../repositories";
import type { Streak } from "../repositories/streak.repository";

/**
 * R4-3 (I11 / ADR-0023's sibling decision, R4 doc D2, Option A). `upsertStreak`
 * had no production caller — no food-log or job path ever wrote `streaks`, so
 * every read defaulted to 0 forever. This wires the derived state: streaks are
 * computed from the log stream on write, keyed on the user's LOCAL day (the
 * same `payload.day` string the client already sends for every log, which
 * `daily_summaries` is keyed on too — so streak and summary can't disagree,
 * unlike a server-UTC "today" would (shares the R1/I3 failure mode)).
 *
 * Product decision made explicitly here (flagged as open in the R4 doc):
 * *any* logged day counts as qualifying — not "hit the calorie goal" — and
 * there is no grace/streak-freeze. Both are product calls a fix-the-defect
 * phase shouldn't make unilaterally in the other direction; "any log counts"
 * is the simpler, more common behavior and is easy to tighten later without a
 * data migration (the stored state doesn't encode which rule produced it).
 *
 * Known limitation, accepted: this only advances on a WRITE. A user who stops
 * logging keeps seeing their last streak number until their next log either
 * continues it or resets it — there is no nightly sweep (Option B, explicitly
 * not chosen) that zeroes a streak the instant it goes stale. Deleting the
 * only log of a day does not retroactively un-advance the streak either.
 */

export interface StreakState {
  currentStreak: number;
  longestStreak: number;
  lastLoggedDate: string | null; // YYYY-MM-DD, user-local
}

export const EMPTY_STREAK_STATE: StreakState = {
  currentStreak: 0,
  longestStreak: 0,
  lastLoggedDate: null,
};

/** `day` is the very next local day after `previous` (both YYYY-MM-DD). */
function isNextLocalDay(previous: string, day: string): boolean {
  const next = new Date(`${previous}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10) === day;
}

/**
 * Pure fold: given the current streak state and a new qualifying local day,
 * return the next state. No `Date.now()` dependency, so it's directly
 * unit-testable and reusable by the backfill (folding a user's full history).
 *
 * Idempotent per (user, day): replaying the same day is a no-op. A day at or
 * before `lastLoggedDate` (a retry, or an out-of-order/backdated write that a
 * more recent qualifying day already covers) is also a no-op — it never moves
 * `lastLoggedDate` backward or double-counts.
 */
export function computeNextStreak(current: StreakState, day: string): StreakState {
  if (current.lastLoggedDate !== null && day <= current.lastLoggedDate) {
    return current;
  }
  const nextCurrent =
    current.lastLoggedDate !== null && isNextLocalDay(current.lastLoggedDate, day)
      ? current.currentStreak + 1
      : 1; // first-ever qualifying day, or a gap broke the streak
  return {
    currentStreak: nextCurrent,
    longestStreak: Math.max(current.longestStreak, nextCurrent),
    lastLoggedDate: day,
  };
}

/** Pure fold over a user's full (ascending) history of qualifying local days — the backfill's core. */
export function foldStreakFromLocalDates(sortedLocalDates: string[]): StreakState {
  return sortedLocalDates.reduce(computeNextStreak, EMPTY_STREAK_STATE);
}

function toStreakState(row: Streak | null): StreakState {
  if (!row) return EMPTY_STREAK_STATE;
  return {
    currentStreak: row.currentStreak,
    longestStreak: row.longestStreak,
    lastLoggedDate: row.lastLoggedDate,
  };
}

/**
 * Record a qualifying log for `day` inside the caller's food-log transaction
 * (Option A: same transaction as `food.service.refreshDailySummary`, not a
 * separate job). Advisory-locked per user so two concurrent same-day logs
 * can't both read the pre-update row and double-advance the streak.
 */
export async function recordQualifyingDay(
  userId: string,
  day: string,
  tx: Executor
): Promise<Streak> {
  await streakRepo.lockForUser(userId, tx);
  const existing = await streakRepo.getByUser(userId, tx);
  const next = computeNextStreak(toStreakState(existing), day);
  if (
    existing &&
    next.currentStreak === existing.currentStreak &&
    next.lastLoggedDate === existing.lastLoggedDate
  ) {
    return existing; // true no-op (replay / backdated day already covered) — skip the write
  }
  return streakRepo.upsertStreak(
    {
      userId,
      currentStreak: next.currentStreak,
      longestStreak: next.longestStreak,
      lastLoggedDate: next.lastLoggedDate,
    },
    tx
  );
}

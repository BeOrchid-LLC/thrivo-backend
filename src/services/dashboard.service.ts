import {
  type DashboardCalories,
  type MacroSummary,
  type StreakSummary,
} from "../../contracts/src/dashboard";
import { type DailyTotals, type FoodLogEntry, type HistoryDay } from "../../contracts/src/foods";
import { type Water } from "../../contracts/src/metrics";
import { cacheAside } from "../lib/cache";
import { foodLogRepo, dailySummaryRepo, streakRepo, waterIntakeRepo } from "../repositories";
import type { FoodLog } from "../repositories/food-log.repository";
import type { User } from "../repositories/user.repository";
import { isPremium } from "./entitlement.service";
import { dashboardCacheKeys } from "./dashboard-cache.service";

const CACHE_TTL_SECONDS = 60;
const HISTORY_CACHE_TTL_SECONDS = 30;
const DEFAULT_TARGET_CALORIES = 1800;
const GLASS_ML = 250;
const TARGET_GLASSES = 8;
export const FREE_HISTORY_LIMIT_DAYS = 7;

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function targetCaloriesFor(user: User): number {
  return user.manualDailyTargetKcal ?? user.dailyTargetKcal ?? DEFAULT_TARGET_CALORIES;
}

function macroTargetsFor(user: User, calories: number) {
  return {
    proteinG: user.targetProteinG ?? Math.round((calories * 0.3) / 4),
    carbsG: user.targetCarbsG ?? Math.round((calories * 0.4) / 4),
    fatG: user.targetFatG ?? Math.round((calories * 0.3) / 9),
  };
}

async function totalsForDay(user: User, day: string) {
  const summary = await dailySummaryRepo.getForDay(user.id, day);
  if (summary) {
    return {
      calories: summary.totalCalories,
      proteinG: toNumber(summary.totalProteinG),
      carbsG: toNumber(summary.totalCarbsG),
      fatG: toNumber(summary.totalFatG),
    };
  }
  return foodLogRepo.totalsForDay(user.id, day);
}

export async function getDashboardCalories(user: User, day: string): Promise<DashboardCalories> {
  return cacheAside(dashboardCacheKeys.calories(user.id, day), CACHE_TTL_SECONDS, async () => {
    const totals = await totalsForDay(user, day);
    const targetCalories = targetCaloriesFor(user);
    const remainingCalories = Math.max(targetCalories - totals.calories, 0);
    return {
      day,
      consumedCalories: totals.calories,
      targetCalories,
      remainingCalories,
      percentUsed:
        targetCalories > 0
          ? Math.min(Math.round((totals.calories / targetCalories) * 100), 100)
          : 0,
    };
  });
}

export async function getDashboardMacros(user: User, day: string): Promise<MacroSummary> {
  return cacheAside(dashboardCacheKeys.macros(user.id, day), CACHE_TTL_SECONDS, async () => {
    const totals = await totalsForDay(user, day);
    return {
      day,
      consumed: {
        proteinG: totals.proteinG,
        carbsG: totals.carbsG,
        fatG: totals.fatG,
      },
      target: macroTargetsFor(user, targetCaloriesFor(user)),
    };
  });
}

export async function getDashboardStreak(user: User): Promise<StreakSummary> {
  return cacheAside(dashboardCacheKeys.streak(user.id), CACHE_TTL_SECONDS, async () => {
    const row = await streakRepo.getByUser(user.id);
    return {
      currentStreakDays: row?.currentStreak ?? 0,
      longestStreakDays: row?.longestStreak ?? 0,
      lastLoggedDay: row?.lastLoggedDate ?? null,
    };
  });
}

export async function getWaterState(user: User, day: string): Promise<Water> {
  return cacheAside(dashboardCacheKeys.water(user.id, day), CACHE_TTL_SECONDS, async () => {
    const totalMl = await waterIntakeRepo.getDayTotal(user.id, day);
    const entries = await waterIntakeRepo.listEntriesForDay(user.id, day);
    const targetMl = GLASS_ML * TARGET_GLASSES;
    const remainingMl = Math.max(targetMl - totalMl, 0);
    const progressPercent =
      targetMl > 0 ? Math.min(Math.round((totalMl / targetMl) * 100), 100) : 0;
    return {
      day,
      totalMl,
      targetMl,
      remainingMl,
      progressPercent,
      glassMl: GLASS_ML,
      glasses: Math.round(totalMl / GLASS_ML),
      targetGlasses: TARGET_GLASSES,
      entries: entries.map((entry) => ({
        id: entry.id,
        amountMl: entry.amountMl,
        day: entry.localDate,
        recordedAt: entry.recordedAt.toISOString(),
      })),
      alert: buildHydrationAlert(totalMl, targetMl, new Date()),
    };
  });
}

export async function getFoodEntriesForDay(user: User, day: string): Promise<FoodLogEntry[]> {
  return cacheAside(dashboardCacheKeys.meals(user.id, day), CACHE_TTL_SECONDS, async () => {
    const logs = await foodLogRepo.listLogsForDay(user.id, day);
    return logs.map(toFoodLogEntry);
  });
}

export async function getFoodLogDayDetail(user: User, day: string, today?: string) {
  const { lockBefore } = resolveHistoryWindow({ today });
  const locked = !isPremium(user) && day < lockBefore;
  const entries = locked ? [] : await getFoodEntriesForDay(user, day);

  return {
    day,
    entries,
    isEmptyDay: entries.length === 0,
    isLocked: locked,
    lockReason: locked ? ("free_history_limit" as const) : null,
    historyLimitDays: FREE_HISTORY_LIMIT_DAYS,
    totals: totalsFromEntries(day, entries),
  };
}

export interface HistoryWindow {
  today: string;
  to: string;
  from: string;
  lockBefore: string;
}

/**
 * D3 (I3): the free-history lock boundary must use the caller's LOCAL day,
 * never server-UTC — a server-UTC "today" drifts a full day off the client's
 * actual day for any non-UTC user near midnight (e.g. a UTC-7 user opening
 * history at 18:00 local, when server UTC has already rolled to the next
 * date). Precedence: an explicit `today` (the local-day string the client
 * already computes for every write, via localDay()) wins; `to` is the older,
 * weaker signal for clients that haven't upgraded; server-UTC is the
 * last-resort fallback so this stays backward compatible. Pure — no `Date`
 * dependency beyond the injected `now`, so it's directly unit-testable
 * against the exact tz-boundary cases (UTC-7, UTC+13, DST edges).
 */
export function resolveHistoryWindow(
  options: { from?: string; to?: string; today?: string },
  now: Date = new Date()
): HistoryWindow {
  const serverToday = isoDay(now);
  const today = options.today ?? options.to ?? serverToday;
  const to = options.to ?? today;
  const from = options.from ?? addDays(to, -29);
  const lockBefore = addDays(today, -(FREE_HISTORY_LIMIT_DAYS - 1));
  return { today, to, from, lockBefore };
}

export async function getHistoryDays(
  user: User,
  options: { from?: string; to?: string; today?: string }
): Promise<{ days: HistoryDay[]; historyLimitDays: number }> {
  const { today, to, from, lockBefore } = resolveHistoryWindow(options);
  const premium = isPremium(user);
  const key = `${dashboardCacheKeys.history(user.id)}:${premium ? "premium" : "free"}:${from}:${to}:${today}`;

  return cacheAside(key, HISTORY_CACHE_TTL_SECONDS, async () => {
    const logs = await foodLogRepo.listLogsByLocalDateRange(user.id, from, to);
    const groupedByDate = new Map<string, FoodLog[]>();
    for (const log of logs) {
      const rows = groupedByDate.get(log.localDate) ?? [];
      rows.push(log);
      groupedByDate.set(log.localDate, rows);
    }

    const days: HistoryDay[] = Array.from(groupedByDate.entries())
      .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
      .map(([day, dayLogs]) => {
        const locked = !premium && day < lockBefore;
        return {
          day,
          isLocked: locked,
          lockReason: locked ? "free_history_limit" : null,
          entries: locked ? [] : dayLogs.map(toFoodLogEntry),
        };
      });

    return { days, historyLimitDays: FREE_HISTORY_LIMIT_DAYS };
  });
}

function toFoodLogEntry(log: FoodLog): FoodLogEntry {
  return {
    id: log.id,
    foodItemId: log.foodItemId,
    name: log.name,
    day: log.localDate,
    servings: toNumber(log.servingQty) || 1,
    servingUnit: log.servingUnit,
    source: log.source,
    barcode: log.barcode,
    isEstimated: log.foodItemId === null && log.source === "manual",
    nutrients: {
      calories: log.kcal,
      proteinG: toNumber(log.proteinG),
      carbsG: toNumber(log.carbsG),
      fatG: toNumber(log.fatG),
    },
    consumedAt: log.consumedAt.toISOString(),
    loggedAt: log.loggedAt.toISOString(),
  };
}

function totalsFromEntries(day: string, entries: FoodLogEntry[]): DailyTotals {
  return entries.reduce<DailyTotals>(
    (totals, entry) => ({
      day,
      calories: totals.calories + entry.nutrients.calories,
      proteinG: totals.proteinG + entry.nutrients.proteinG,
      carbsG: totals.carbsG + entry.nutrients.carbsG,
      fatG: totals.fatG + entry.nutrients.fatG,
    }),
    { day, calories: 0, proteinG: 0, carbsG: 0, fatG: 0 }
  );
}

function buildHydrationAlert(totalMl: number, targetMl: number, now: Date): Water["alert"] {
  if (targetMl <= 0 || totalMl >= targetMl) return null;
  const hour = now.getHours();
  const expectedProgress = Math.min(Math.max((hour - 6) / 14, 0), 1);
  const expectedMl = Math.round(targetMl * expectedProgress);
  if (hour < 12 || totalMl >= expectedMl || totalMl / targetMl >= 0.75) return null;
  const remainingMl = Math.max(targetMl - totalMl, 0);
  return {
    title: "Drink up",
    message: `You're behind your hydration pace. Try to drink ${remainingMl.toLocaleString()}ml more today.`,
    severity: "warning",
  };
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return isoDay(date);
}

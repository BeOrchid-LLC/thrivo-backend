import {
  type DashboardCalories,
  type MacroSummary,
  type StreakSummary,
} from "../../contracts/src/dashboard";
import {
  type DailyTotals,
  type FoodLogEntry,
  type FoodLogHistoryLockedRange,
  type HistoryDay,
} from "../../contracts/src/foods";
import {
  type ChartPeriod,
  type Water,
  type WaterHistoryDay,
  type WaterHistoryLockedRange,
} from "../../contracts/src/metrics";
import { cacheAside } from "../lib/cache";
import {
  foodFavoriteRepo,
  foodLogRepo,
  dailySummaryRepo,
  streakRepo,
  waterIntakeRepo,
} from "../repositories";
import type { FoodLog } from "../repositories/food-log.repository";
import type { User } from "../repositories/user.repository";
import { isPremium } from "./entitlement.service";
import { dashboardCacheKeys } from "./dashboard-cache.service";
import { localHourFor } from "../lib/local-date";

const CACHE_TTL_SECONDS = 60;
const HISTORY_CACHE_TTL_SECONDS = 30;
const DEFAULT_TARGET_CALORIES = 1800;
const GLASS_ML = 250;
const TARGET_GLASSES = 8;
const HYDRATION_DAY_START_HOUR = 8;
const HYDRATION_EVENING_TARGET_HOUR = 20;
const HYDRATION_DAY_END_HOUR = 22;
const HYDRATION_EVENING_TARGET_PROGRESS = 0.75;
const HYDRATION_ALERT_TOLERANCE_PERCENT = 5;
export const FREE_HISTORY_LIMIT_DAYS = 7;
const WATER_HISTORY_PERIOD_DAYS: Record<Exclude<ChartPeriod, "all">, number> = {
  "7d": 7,
  "14d": 14,
  "1m": 30,
  "1q": 90,
  "6m": 180,
  "1y": 365,
};
type HistoryPeriod = ChartPeriod;
const FOOD_HISTORY_PERIOD_DAYS = WATER_HISTORY_PERIOD_DAYS;

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
      alert: buildHydrationAlert(totalMl, targetMl, localHourFor(user.timezone)),
    };
  });
}

export async function getWaterHistory(
  user: User,
  options: { date: string; period: ChartPeriod; today?: string }
): Promise<{
  period: ChartPeriod;
  date: string;
  from: string;
  to: string;
  days: WaterHistoryDay[];
  lockedRange: WaterHistoryLockedRange | null;
  historyLimitDays: number;
}> {
  const { from, to } = waterHistoryRange(options.period, options.date);
  const { lockBefore } = resolveHistoryWindow({ from, to, today: options.today ?? options.date });
  const premium = isPremium(user);
  const visibleFrom = !premium && from < lockBefore ? lockBefore : from;
  const lockedRange =
    !premium && from < lockBefore
      ? ({
          from,
          to: minDay(addDays(lockBefore, -1), to),
          lockReason: "free_history_limit",
        } satisfies WaterHistoryLockedRange)
      : null;
  const key = `${dashboardCacheKeys.waterHistory(user.id)}:${premium ? "premium" : "free"}:${options.period}:${from}:${to}:${options.today ?? options.date}`;

  return cacheAside(key, HISTORY_CACHE_TTL_SECONDS, async () => {
    const entries =
      visibleFrom <= to
        ? await waterIntakeRepo.listEntriesByLocalDateRange(user.id, visibleFrom, to)
        : [];
    const groupedByDate = new Map<string, typeof entries>();
    for (const entry of entries) {
      const rows = groupedByDate.get(entry.localDate) ?? [];
      rows.push(entry);
      groupedByDate.set(entry.localDate, rows);
    }

    const days = Array.from(groupedByDate.entries()).map(([day, dayEntries]) => ({
      day,
      totalMl: dayEntries.reduce((total, entry) => total + entry.amountMl, 0),
      entries: dayEntries.map((entry) => ({
        id: entry.id,
        amountMl: entry.amountMl,
        day: entry.localDate,
        recordedAt: entry.recordedAt.toISOString(),
      })),
    }));

    return {
      period: options.period,
      date: options.date,
      from,
      to,
      days,
      lockedRange,
      historyLimitDays: FREE_HISTORY_LIMIT_DAYS,
    };
  });
}

export async function getFoodEntriesForDay(user: User, day: string): Promise<FoodLogEntry[]> {
  return cacheAside(dashboardCacheKeys.meals(user.id, day), CACHE_TTL_SECONDS, async () => {
    const logs = await foodLogRepo.listLogsForDay(user.id, day);
    const favoriteIds = await favoriteIdsForLogs(user.id, logs);
    return logs.map((log) => toFoodLogEntry(log, favoriteIds));
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
  options: { from?: string; to?: string; today?: string; date?: string; period?: HistoryPeriod }
): Promise<{
  period: HistoryPeriod;
  date: string;
  from: string;
  to: string;
  days: HistoryDay[];
  lockedRange: FoodLogHistoryLockedRange | null;
  historyLimitDays: number;
}> {
  const period = options.period ?? "1m";
  const date = options.date ?? options.to ?? options.today ?? isoDay(new Date());
  const periodRange = foodHistoryRange(period, date);
  const { today, to, from, lockBefore } = resolveHistoryWindow({
    from: options.from ?? periodRange.from,
    to: options.to ?? periodRange.to,
    today: options.today ?? date,
  });
  const premium = isPremium(user);
  const key = `${dashboardCacheKeys.history(user.id)}:${premium ? "premium" : "free"}:${from}:${to}:${today}`;
  const visibleFrom = !premium && from < lockBefore ? lockBefore : from;
  const lockedRange =
    !premium && from < lockBefore
      ? ({
          from,
          to: minDay(addDays(lockBefore, -1), to),
          lockReason: "free_history_limit",
        } satisfies FoodLogHistoryLockedRange)
      : null;

  return cacheAside(key, HISTORY_CACHE_TTL_SECONDS, async () => {
    const logs =
      visibleFrom <= to ? await foodLogRepo.listLogsByLocalDateRange(user.id, visibleFrom, to) : [];
    const favoriteIds = await favoriteIdsForLogs(user.id, logs);
    const groupedByDate = new Map<string, FoodLog[]>();
    for (const log of logs) {
      const rows = groupedByDate.get(log.localDate) ?? [];
      rows.push(log);
      groupedByDate.set(log.localDate, rows);
    }

    const days: HistoryDay[] = Array.from(groupedByDate.entries())
      .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
      .map(([day, dayLogs]) => {
        return {
          day,
          isLocked: false,
          lockReason: null,
          entries: dayLogs.map((log) => toFoodLogEntry(log, favoriteIds)),
        };
      });

    return { period, date, from, to, days, lockedRange, historyLimitDays: FREE_HISTORY_LIMIT_DAYS };
  });
}

function toFoodLogEntry(log: FoodLog, favoriteIds: ReadonlySet<string> = new Set()): FoodLogEntry {
  return {
    id: log.id,
    foodItemId: log.foodItemId,
    name: log.name,
    day: log.localDate,
    servings: toNumber(log.servingQty) || 1,
    servingUnit: log.servingUnit,
    source: log.source,
    barcode: log.barcode,
    isEstimated: log.source === "manual",
    isFavorite: log.foodItemId ? favoriteIds.has(log.foodItemId) : false,
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

async function favoriteIdsForLogs(userId: string, logs: readonly FoodLog[]): Promise<Set<string>> {
  return foodFavoriteRepo.listMatchingIdsForUser(
    userId,
    logs.map((log) => log.foodItemId).filter((id): id is string => Boolean(id))
  );
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

export function buildHydrationAlert(
  totalMl: number,
  targetMl: number,
  localHour: number
): Water["alert"] {
  if (targetMl <= 0 || totalMl >= targetMl) return null;
  const progressPercent = Math.min(Math.round((totalMl / targetMl) * 100), 100);
  const expectedProgressPercent = Math.round(expectedHydrationProgress(localHour) * 100);
  if (expectedProgressPercent <= 0) return null;
  if (progressPercent + HYDRATION_ALERT_TOLERANCE_PERCENT >= expectedProgressPercent) return null;
  const targetProgressPercent =
    localHour < HYDRATION_EVENING_TARGET_HOUR
      ? Math.round(HYDRATION_EVENING_TARGET_PROGRESS * 100)
      : 100;
  const targetHour =
    localHour < HYDRATION_EVENING_TARGET_HOUR
      ? HYDRATION_EVENING_TARGET_HOUR
      : HYDRATION_DAY_END_HOUR;

  return {
    title: "Drink up",
    message: `It's ${formatHour(localHour)} and you've only hit ${progressPercent}% of your daily goal. Try to reach ${targetProgressPercent}% by ${formatHour(targetHour)}.`,
    severity: "warning",
  };
}

function expectedHydrationProgress(localHour: number): number {
  if (localHour < HYDRATION_DAY_START_HOUR) return 0;
  if (localHour <= HYDRATION_EVENING_TARGET_HOUR) {
    const elapsed = localHour - HYDRATION_DAY_START_HOUR;
    const window = HYDRATION_EVENING_TARGET_HOUR - HYDRATION_DAY_START_HOUR;
    return (elapsed / window) * HYDRATION_EVENING_TARGET_PROGRESS;
  }
  if (localHour <= HYDRATION_DAY_END_HOUR) {
    const elapsed = localHour - HYDRATION_EVENING_TARGET_HOUR;
    const window = HYDRATION_DAY_END_HOUR - HYDRATION_EVENING_TARGET_HOUR;
    return (
      HYDRATION_EVENING_TARGET_PROGRESS +
      (elapsed / window) * (1 - HYDRATION_EVENING_TARGET_PROGRESS)
    );
  }
  return 1;
}

function formatHour(hour: number): string {
  const normalized = hour % 24;
  const display = normalized % 12 || 12;
  return `${display} ${normalized < 12 ? "AM" : "PM"}`;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return isoDay(date);
}

function waterHistoryRange(period: ChartPeriod, toDay: string): { from: string; to: string } {
  if (period === "all") return { from: "1970-01-01", to: toDay };
  return { from: addDays(toDay, 1 - WATER_HISTORY_PERIOD_DAYS[period]), to: toDay };
}

function foodHistoryRange(period: HistoryPeriod, toDay: string): { from: string; to: string } {
  if (period === "all") return { from: "1970-01-01", to: toDay };
  return { from: addDays(toDay, 1 - FOOD_HISTORY_PERIOD_DAYS[period]), to: toDay };
}

function minDay(a: string, b: string): string {
  return a <= b ? a : b;
}

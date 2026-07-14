import type { ChartMetric, ChartPeriod } from "../../contracts/src/metrics";
import { db } from "../../db";
import { toNumeric1 } from "../lib/units";
import { PremiumRequiredError, NotFoundError } from "../lib/errors";
import {
  dailySummaryRepo,
  foodLogRepo,
  streakRepo,
  userRepo,
  waterIntakeRepo,
  weightEntryRepo,
} from "../repositories";
import type { User } from "../repositories/user.repository";
import { isPremium } from "./entitlement.service";
import {
  invalidateProfileTargetCache,
  invalidateWaterDashboardCache,
} from "./dashboard-cache.service";
import { updateUserProfile } from "./user.service";

const LONG_PERIODS = new Set<ChartPeriod>(["1m", "1q", "6m", "1y", "all"]);
const PERIOD_DAYS: Record<Exclude<ChartPeriod, "all">, number> = {
  "7d": 7,
  "14d": 14,
  "1m": 30,
  "1q": 90,
  "6m": 180,
  "1y": 365,
};

type ChartPoint = { date: string; value: number | null };

function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfWeek(date: Date): Date {
  return addDays(date, -date.getUTCDay());
}

function monthName(day: string): string {
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    parseDay(day)
  );
}

function monthShort(day: string): string {
  return new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" }).format(
    parseDay(day)
  );
}

function numberFromDb(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Number.parseFloat(String(value));
}

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function chartRange(period: ChartPeriod, toDay: string): { from: string; to: string } {
  if (period === "all") return { from: "1970-01-01", to: toDay };
  const to = parseDay(toDay);
  return { from: formatDay(addDays(to, 1 - PERIOD_DAYS[period])), to: toDay };
}

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let cursor = parseDay(from); cursor <= parseDay(to); cursor = addDays(cursor, 1)) {
    out.push(formatDay(cursor));
  }
  return out;
}

function fillDailyPoints(
  from: string,
  to: string,
  values: Map<string, number | null>,
  emptyValue: number | null
): ChartPoint[] {
  return daysBetween(from, to).map((date) => ({ date, value: values.get(date) ?? emptyValue }));
}

export function assertChartAccess(user: User, period: ChartPeriod): void {
  if (LONG_PERIODS.has(period) && !isPremium(user)) {
    throw new PremiumRequiredError("Premium is required for activity history beyond 14 days");
  }
}

export async function getProgress(user: User, day: string) {
  const weekStart = formatDay(startOfWeek(parseDay(day)));
  // Five independent reads (R5-2/I14) — sequential awaits here just stack latency.
  const [current, streak, weekSummaries, calendar, projection] = await Promise.all([
    currentWeightKg(user),
    streakRepo.getByUser(user.id),
    dailySummaryRepo.listRange(user.id, weekStart, day),
    buildFoodCalendar(user.id, day),
    buildGoalProjection(user, day),
  ]);
  const targetWeightKg = numberFromDb(user.targetWeightKg);
  const weekCalories = weekSummaries.reduce((sum, row) => sum + row.totalCalories, 0);
  const currentWeekAverageKcal = Math.round(weekCalories / 7);

  return {
    day,
    summary: {
      currentWeightKg: current,
      targetWeightKg,
      goalGapKg:
        current !== null && targetWeightKg !== null
          ? round(Math.abs(current - targetWeightKg))
          : null,
      currentStreakDays: streak?.currentStreak ?? 0,
      longestStreakDays: streak?.longestStreak ?? 0,
      currentWeekAverageKcal,
    },
    projection,
    calendar,
  };
}

export async function getMetricChart(
  user: User,
  metric: ChartMetric,
  period: ChartPeriod,
  day: string
) {
  assertChartAccess(user, period);
  const { from, to } = chartRange(period, day);
  const points =
    metric === "calories"
      ? await caloriesPoints(user.id, from, to, period)
      : metric === "water"
        ? await waterPoints(user.id, from, to, period)
        : metric === "weight"
          ? await weightPoints(user.id, from, to, period)
          : await macroPoints(user.id, from, to, period, metric);

  return {
    metric,
    period,
    unit:
      metric === "calories" ? "kcal" : metric === "water" ? "ml" : metric === "weight" ? "kg" : "g",
    from,
    to,
    points,
  };
}

export async function getWeightContext(user: User, day: string) {
  const [today, yesterday, weekEntries, projection] = await Promise.all([
    weightEntryRepo.getLatestForDay(user.id, day),
    weightEntryRepo.getLatestForDay(user.id, formatDay(addDays(parseDay(day), -1))),
    weightEntryRepo.listForLocalDateRange(user.id, formatDay(addDays(parseDay(day), -6)), day),
    buildGoalProjection(user, day),
  ]);
  const current = today ? Number(today.weightKg) : await currentWeightKg(user);
  const latestByDay = latestWeightByDay(weekEntries);
  const values = Array.from(latestByDay.values());

  return {
    day,
    currentWeightKg: current,
    yesterdayWeightKg: yesterday ? Number(yesterday.weightKg) : null,
    sevenDayAverageKg:
      values.length > 0
        ? round(values.reduce((sum, value) => sum + value, 0) / values.length)
        : null,
    targetWeightKg: numberFromDb(user.targetWeightKg),
    projection,
  };
}

export async function saveWeight(user: User, day: string, weightKg: number) {
  const entry = await db.transaction(async (tx) => {
    const existing = await weightEntryRepo.getLatestForDay(user.id, day, tx);
    if (existing) {
      const updated = await weightEntryRepo.updateEntryForUser(
        user.id,
        existing.id,
        {
          weightKg: toNumeric1(weightKg),
          localDate: day,
          recordedAt: new Date(),
          source: "manual",
        },
        tx
      );
      if (!updated) throw new NotFoundError("Weight entry not found");
      return updated;
    }
    return weightEntryRepo.createEntry(
      {
        userId: user.id,
        weightKg: toNumeric1(weightKg),
        localDate: day,
        recordedAt: new Date(),
        source: "manual",
      },
      tx
    );
  });

  await updateUserProfile(user, { currentWeightKg: weightKg });
  await invalidateProfileTargetCache(user.id);
  return toWeightEntry(entry);
}

export async function deleteWeight(user: User, id: string) {
  const deleted = await weightEntryRepo.deleteEntryForUser(id, user.id);
  if (!deleted) throw new NotFoundError("Weight entry not found");
  const latest = await weightEntryRepo.getLatestForUser(user.id);
  await userRepo.updateProfile(user.id, { weightKg: latest?.weightKg ?? null });
  await invalidateProfileTargetCache(user.id);
  return deleted;
}

/**
 * Log a glass of water. Idempotency-keyed so an offline-queue replay / retry
 * doesn't double-count. (Weight needs no key — saveWeight upserts per day.)
 */
export async function saveWater(
  user: User,
  day: string,
  amountMl: number,
  idempotencyKey?: string | null
) {
  const entry = await waterIntakeRepo.addEntry({
    userId: user.id,
    localDate: day,
    amountMl,
    recordedAt: new Date(),
    idempotencyKey: idempotencyKey ?? null,
  });
  await invalidateWaterDashboardCache(user.id, day);
  return entry;
}

function toWeightEntry(entry: {
  id: string;
  weightKg: string;
  localDate: string;
  recordedAt: Date;
}) {
  return {
    id: entry.id,
    weightKg: Number(entry.weightKg),
    day: entry.localDate,
    recordedAt: entry.recordedAt.toISOString(),
  };
}

async function currentWeightKg(user: User): Promise<number | null> {
  const latest = await weightEntryRepo.getLatestForUser(user.id);
  return latest ? Number(latest.weightKg) : numberFromDb(user.weightKg);
}

async function caloriesPoints(userId: string, from: string, to: string, period: ChartPeriod) {
  const rows = await dailySummaryRepo.listRange(userId, from, to);
  const values = new Map(rows.map((row) => [row.localDate, row.totalCalories]));
  if (period === "all")
    return rows.map((row) => ({ date: row.localDate, value: row.totalCalories }));
  return fillDailyPoints(from, to, values, 0);
}

async function waterPoints(userId: string, from: string, to: string, period: ChartPeriod) {
  const rows = await waterIntakeRepo.listTotalsRange(userId, from, to);
  const values = new Map(rows.map((row) => [row.day, row.totalMl]));
  if (period === "all") return rows.map((row) => ({ date: row.day, value: row.totalMl }));
  return fillDailyPoints(from, to, values, 0);
}

async function weightPoints(userId: string, from: string, to: string, period: ChartPeriod) {
  const rows = await weightEntryRepo.listForLocalDateRange(userId, from, to);
  const values = latestWeightByDay(rows);
  if (period === "all") {
    return Array.from(values.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value }));
  }
  return fillDailyPoints(from, to, values, null);
}

async function macroPoints(
  userId: string,
  from: string,
  to: string,
  period: ChartPeriod,
  metric: "protein" | "carbs" | "fat"
) {
  const rows = await dailySummaryRepo.listRange(userId, from, to);
  const values = new Map(
    rows.map((row) => [
      row.localDate,
      metric === "protein"
        ? numberFromDb(row.totalProteinG)
        : metric === "carbs"
          ? numberFromDb(row.totalCarbsG)
          : numberFromDb(row.totalFatG),
    ])
  );
  if (period === "all") {
    return rows.map((row) => ({
      date: row.localDate,
      value:
        metric === "protein"
          ? numberFromDb(row.totalProteinG)
          : metric === "carbs"
            ? numberFromDb(row.totalCarbsG)
            : numberFromDb(row.totalFatG),
    }));
  }
  return fillDailyPoints(from, to, values, 0);
}

function latestWeightByDay(rows: Array<{ localDate: string; weightKg: string; recordedAt: Date }>) {
  const values = new Map<string, number>();
  for (const row of rows) {
    if (!values.has(row.localDate)) values.set(row.localDate, Number(row.weightKg));
  }
  return values;
}

async function buildFoodCalendar(userId: string, day: string) {
  const current = parseDay(day);
  const monthStart = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0));
  const gridStart = startOfWeek(monthStart);
  const gridEnd = addDays(startOfWeek(monthEnd), 6);
  const loggedDates = await foodLogRepo.listDistinctLocalDatesInRange(
    userId,
    formatDay(gridStart),
    formatDay(gridEnd)
  );
  const loggedDays = new Set(loggedDates);
  const days = daysBetween(formatDay(gridStart), formatDay(gridEnd)).map((date) => {
    const parsed = parseDay(date);
    return {
      day: date,
      dayOfMonth: parsed.getUTCDate(),
      logged: loggedDays.has(date),
      today: date === day,
      inMonth: parsed.getUTCMonth() === current.getUTCMonth(),
    };
  });
  return { month: monthName(day), days };
}

async function buildGoalProjection(user: User, day: string) {
  const target = numberFromDb(user.targetWeightKg);
  const rangeStart = formatDay(addDays(parseDay(day), -13));
  const rows = await weightEntryRepo.listForLocalDateRange(user.id, rangeStart, day);
  const values = Array.from(latestWeightByDay(rows).entries()).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  if (target === null || values.length < 2) {
    return {
      projectedDate: null,
      projectedMonth: null,
      weeklyRateKg: null,
      status: "not_enough_data" as const,
    };
  }

  const [firstDay, first] = values[0]!;
  const [lastDay, last] = values[values.length - 1]!;
  const elapsedDays = Math.max(
    1,
    Math.round((parseDay(lastDay).getTime() - parseDay(firstDay).getTime()) / 86_400_000)
  );
  const weeklyRateKg = round(((last - first) / elapsedDays) * 7);
  const goal = user.goal;
  const movingTowardGoal =
    goal === "maintain"
      ? Math.abs(last - target) <= 1
      : goal === "lose"
        ? weeklyRateKg < 0
        : weeklyRateKg > 0;
  const remaining = Math.abs(last - target);
  const projectedDays =
    movingTowardGoal && Math.abs(weeklyRateKg) > 0
      ? Math.ceil((remaining / Math.abs(weeklyRateKg)) * 7)
      : null;
  const projectedDate =
    projectedDays === null ? null : formatDay(addDays(parseDay(day), projectedDays));

  return {
    projectedDate,
    projectedMonth: projectedDate ? monthShort(projectedDate) : null,
    weeklyRateKg,
    status:
      goal === "maintain"
        ? ("maintaining" as const)
        : movingTowardGoal
          ? ("on_track" as const)
          : ("off_track" as const),
  };
}

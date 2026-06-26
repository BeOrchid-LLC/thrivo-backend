import {
  type DashboardCalories,
  type MacroSummary,
  type StreakSummary,
} from "../../contracts/src/dashboard";
import { type MealGroup, type FoodLogEntry, type HistoryDay } from "../../contracts/src/foods";
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

const MEAL_LABEL: Record<MealGroup["meal"], string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snacks",
};

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
    return {
      day,
      totalMl,
      targetMl: GLASS_ML * TARGET_GLASSES,
      glassMl: GLASS_ML,
      glasses: Math.floor(totalMl / GLASS_ML),
      targetGlasses: TARGET_GLASSES,
    };
  });
}

export async function getMealGroupsForDay(user: User, day: string): Promise<MealGroup[]> {
  return cacheAside(dashboardCacheKeys.meals(user.id, day), CACHE_TTL_SECONDS, async () => {
    const logs = await foodLogRepo.listLogsForDay(user.id, day);
    return groupLogs(logs);
  });
}

export async function getHistoryDays(
  user: User,
  options: { from?: string; to?: string }
): Promise<{ days: HistoryDay[]; historyLimitDays: number }> {
  const today = isoDay(new Date());
  const to = options.to ?? today;
  const from = options.from ?? addDays(to, -29);
  const premium = isPremium(user);
  const key = `${dashboardCacheKeys.history(user.id)}:${premium ? "premium" : "free"}:${from}:${to}`;

  return cacheAside(key, HISTORY_CACHE_TTL_SECONDS, async () => {
    const logs = await foodLogRepo.listLogsByLocalDateRange(user.id, from, to);
    const groupedByDate = new Map<string, FoodLog[]>();
    for (const log of logs) {
      const rows = groupedByDate.get(log.localDate) ?? [];
      rows.push(log);
      groupedByDate.set(log.localDate, rows);
    }

    const lockBefore = addDays(today, -(FREE_HISTORY_LIMIT_DAYS - 1));
    const days: HistoryDay[] = Array.from(groupedByDate.entries())
      .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
      .map(([day, dayLogs]) => {
        const locked = !premium && day < lockBefore;
        return {
          day,
          isLocked: locked,
          lockReason: locked ? "free_history_limit" : null,
          groups: locked ? [] : groupLogs(dayLogs),
        };
      });

    return { days, historyLimitDays: FREE_HISTORY_LIMIT_DAYS };
  });
}

function groupLogs(logs: FoodLog[]): MealGroup[] {
  const orderedMeals: MealGroup["meal"][] = ["breakfast", "lunch", "dinner", "snack"];
  return orderedMeals
    .map((meal) => {
      const mealLogs = logs.filter((log) => log.meal === meal);
      const entries = mealLogs.map(toFoodLogEntry);
      return {
        meal,
        label: MEAL_LABEL[meal],
        calories: entries.reduce(
          (sum, entry) => sum + Math.round(entry.nutrients.calories * entry.servings),
          0
        ),
        entries,
      };
    })
    .filter((group) => group.entries.length > 0);
}

function toFoodLogEntry(log: FoodLog): FoodLogEntry {
  return {
    id: log.id,
    foodItemId: log.foodItemId,
    name: log.name,
    meal: log.meal,
    day: log.localDate,
    servings: toNumber(log.servingQty) || 1,
    servingUnit: log.servingUnit,
    nutrients: {
      calories: log.kcal,
      proteinG: toNumber(log.proteinG),
      carbsG: toNumber(log.carbsG),
      fatG: toNumber(log.fatG),
    },
    loggedAt: log.loggedAt.toISOString(),
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

import { cacheDel } from "../lib/cache";

const dayKey = (userId: string, day: string, segment: string) =>
  `user:${userId}:day:${day}:${segment}`;

export const dashboardCacheKeys = {
  calories: (userId: string, day: string) => dayKey(userId, day, "calories"),
  macros: (userId: string, day: string) => dayKey(userId, day, "macros"),
  meals: (userId: string, day: string) => dayKey(userId, day, "meals"),
  water: (userId: string, day: string) => dayKey(userId, day, "water"),
  waterHistory: (userId: string) => `user:${userId}:water-history`,
  streak: (userId: string) => `user:${userId}:streak`,
  history: (userId: string) => `user:${userId}:history`,
};

export async function invalidateFoodDashboardCache(userId: string, day: string): Promise<void> {
  await cacheDel(
    dashboardCacheKeys.calories(userId, day),
    dashboardCacheKeys.macros(userId, day),
    dashboardCacheKeys.meals(userId, day),
    dashboardCacheKeys.streak(userId),
    dashboardCacheKeys.history(userId)
  );
}

export async function invalidateWaterDashboardCache(userId: string, day: string): Promise<void> {
  await cacheDel(dashboardCacheKeys.water(userId, day), dashboardCacheKeys.waterHistory(userId));
}

export async function invalidateProfileTargetCache(userId: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await cacheDel(
    dashboardCacheKeys.calories(userId, today),
    dashboardCacheKeys.macros(userId, today),
    dashboardCacheKeys.history(userId)
  );
}

export async function invalidateEntitlementCache(userId: string): Promise<void> {
  await cacheDel(dashboardCacheKeys.history(userId), dashboardCacheKeys.waterHistory(userId));
}

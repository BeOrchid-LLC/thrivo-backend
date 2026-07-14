import type { AdminActivityItem, AdminActivityType } from "../../contracts/src/admin";
import { checkInRepo, foodLogRepo, weightEntryRepo } from "../repositories";
import { clampLimit } from "../lib/pagination";

export interface AdminActivityPage {
  items: AdminActivityItem[];
  total: number;
  limit: number;
}

/** One endpoint, three type-branches — the 3 activity tabs share the same
 *  "recent N of M total" shape, unlike the Overview page's 4 genuinely
 *  different-shaped sections which each got their own route. */
export async function getUserActivity(
  userId: string,
  type: AdminActivityType,
  limitParam?: number
): Promise<AdminActivityPage> {
  const limit = clampLimit(limitParam, 10, 50);

  if (type === "food_logs") {
    const [logs, total] = await Promise.all([
      foodLogRepo.listRecentLogs(userId, limit),
      foodLogRepo.countByUserId(userId),
    ]);
    return {
      items: logs.map((log) => ({
        id: log.id,
        name: log.name,
        localDate: log.localDate,
        servingQty: log.servingQty !== null ? Number(log.servingQty) : null,
        servingUnit: log.servingUnit,
        kcal: log.kcal,
      })),
      total,
      limit,
    };
  }

  if (type === "check_ins") {
    const [checkIns, total] = await Promise.all([
      checkInRepo.listForUser(userId, limit),
      checkInRepo.countByUserId(userId),
    ]);
    return {
      items: checkIns.map((c) => ({
        id: c.id,
        localDate: c.localDate,
        mood: c.mood,
        note: c.note,
      })),
      total,
      limit,
    };
  }

  const [entries, total] = await Promise.all([
    weightEntryRepo.listRecentByUser(userId, limit),
    weightEntryRepo.countByUserId(userId),
  ]);
  return {
    items: entries.map((w) => ({
      id: w.id,
      localDate: w.localDate,
      weightKg: Number(w.weightKg),
      note: w.note,
    })),
    total,
    limit,
  };
}

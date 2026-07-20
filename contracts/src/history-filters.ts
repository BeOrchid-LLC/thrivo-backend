import { z } from "zod";

/**
 * Canonical meal-time buckets derived from the hour of consumption (in the
 * user's local timezone). Exported as a constant so the server's SQL predicate
 * and the client's filter labels both derive from the same source.
 *
 * "night" wraps midnight: startHour > endHour indicates the range crosses 00:00.
 */
export const MEAL_TIME_WINDOWS = {
  morning: { startHour: 4, endHour: 11 }, // 4:00 AM – 10:59 AM
  afternoon: { startHour: 11, endHour: 16 }, // 11:00 AM – 3:59 PM
  evening: { startHour: 16, endHour: 21 }, // 4:00 PM – 8:59 PM
  night: { startHour: 21, endHour: 4 }, // 9:00 PM – 3:59 AM (wraps midnight)
} as const;

export type MealTime = keyof typeof MEAL_TIME_WINDOWS;

export const mealTimeSchema = z.enum(["morning", "afternoon", "evening", "night"]);

export const historySortSchema = z.enum(["newest", "oldest", "highest", "lowest"]);
export type HistorySort = z.infer<typeof historySortSchema>;

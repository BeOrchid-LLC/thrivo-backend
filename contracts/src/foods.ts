import { z } from "zod";
import {
  apiSuccessSchema,
  idSchema,
  isoDateSchema,
  localDaySchema,
  type RouteContract,
} from "./common";

export const mealTypeSchema = z.enum(["breakfast", "lunch", "dinner", "snack"]);
export type MealType = z.infer<typeof mealTypeSchema>;

export const nutrientsSchema = z.object({
  calories: z.number(),
  proteinG: z.number(),
  carbsG: z.number(),
  fatG: z.number(),
});
export type Nutrients = z.infer<typeof nutrientsSchema>;

export const foodLogEntrySchema = z.object({
  id: idSchema,
  foodItemId: idSchema.nullable(),
  name: z.string(),
  meal: mealTypeSchema,
  day: localDaySchema,
  servings: z.number().positive(),
  servingUnit: z.string().nullable(),
  nutrients: nutrientsSchema,
  loggedAt: isoDateSchema,
});
export type FoodLogEntry = z.infer<typeof foodLogEntrySchema>;

export const dailyTotalsSchema = z.object({
  day: localDaySchema,
  calories: z.number(),
  proteinG: z.number(),
  carbsG: z.number(),
  fatG: z.number(),
});
export type DailyTotals = z.infer<typeof dailyTotalsSchema>;

export const mealGroupSchema = z.object({
  meal: mealTypeSchema,
  label: z.string(),
  calories: z.number(),
  entries: z.array(foodLogEntrySchema),
});
export type MealGroup = z.infer<typeof mealGroupSchema>;

export const foodLogDayQuerySchema = z.object({ date: localDaySchema });
export const foodLogDayResponseSchema = apiSuccessSchema(
  z.object({
    day: localDaySchema,
    groups: z.array(mealGroupSchema),
    isEmptyDay: z.boolean(),
  })
);

export const foodLogHistoryQuerySchema = z.object({
  cursor: z.string().optional(),
  from: localDaySchema.optional(),
  to: localDaySchema.optional(),
});

export const historyDaySchema = z.object({
  day: localDaySchema,
  isLocked: z.boolean(),
  lockReason: z.enum(["free_history_limit"]).nullable(),
  groups: z.array(mealGroupSchema),
});
export type HistoryDay = z.infer<typeof historyDaySchema>;

export const foodLogHistoryResponseSchema = apiSuccessSchema(
  z.object({
    days: z.array(historyDaySchema),
    historyLimitDays: z.number().int(),
  })
);

export const foodRoutes = {
  logDay: {
    method: "GET",
    path: "/api/v1/foods/log/day",
    auth: "user",
  },
  logHistory: {
    method: "GET",
    path: "/api/v1/foods/log/history",
    auth: "user",
  },
} satisfies Record<string, RouteContract>;

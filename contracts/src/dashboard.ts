import { z } from "zod";
import { apiSuccessSchema, localDaySchema, type RouteContract } from "./common";
import { dailyTotalsSchema } from "./foods";

export const dashboardDateQuerySchema = z.object({ date: localDaySchema });

export const dashboardCaloriesSchema = z.object({
  day: localDaySchema,
  consumedCalories: z.number(),
  targetCalories: z.number(),
  remainingCalories: z.number(),
  percentUsed: z.number(),
});
export type DashboardCalories = z.infer<typeof dashboardCaloriesSchema>;

export const dashboardCaloriesResponseSchema = apiSuccessSchema(
  z.object({ calories: dashboardCaloriesSchema })
);

export const macroSummarySchema = z.object({
  day: localDaySchema,
  consumed: dailyTotalsSchema.pick({ proteinG: true, carbsG: true, fatG: true }),
  target: z.object({
    proteinG: z.number(),
    carbsG: z.number(),
    fatG: z.number(),
  }),
});
export type MacroSummary = z.infer<typeof macroSummarySchema>;

export const dashboardMacrosResponseSchema = apiSuccessSchema(
  z.object({ macros: macroSummarySchema })
);

export const streakSummarySchema = z.object({
  currentStreakDays: z.number(),
  longestStreakDays: z.number(),
  lastLoggedDay: localDaySchema.nullable(),
});
export type StreakSummary = z.infer<typeof streakSummarySchema>;

export const dashboardStreakResponseSchema = apiSuccessSchema(
  z.object({ streak: streakSummarySchema })
);

export const dashboardRoutes = {
  calories: {
    method: "GET",
    path: "/api/v1/dashboard/calories",
    auth: "user",
  },
  macros: {
    method: "GET",
    path: "/api/v1/dashboard/macros",
    auth: "user",
  },
  streak: {
    method: "GET",
    path: "/api/v1/dashboard/streak",
    auth: "user",
  },
} satisfies Record<string, RouteContract>;

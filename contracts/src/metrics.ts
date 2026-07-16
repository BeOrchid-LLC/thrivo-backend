import { z } from "zod";
import {
  apiSuccessSchema,
  idSchema,
  isoDateSchema,
  localDaySchema,
  type RouteContract,
} from "./common";

export const waterQuerySchema = z.object({ date: localDaySchema });

export const waterEntrySchema = z.object({
  id: idSchema,
  amountMl: z.number().int().positive(),
  day: localDaySchema,
  recordedAt: isoDateSchema,
});
export type WaterEntry = z.infer<typeof waterEntrySchema>;

export const hydrationAlertSchema = z.object({
  title: z.string(),
  message: z.string(),
  severity: z.enum(["info", "warning"]),
});
export type HydrationAlert = z.infer<typeof hydrationAlertSchema>;

export const waterSchema = z.object({
  day: localDaySchema,
  totalMl: z.number(),
  targetMl: z.number(),
  remainingMl: z.number(),
  progressPercent: z.number(),
  glassMl: z.number(),
  glasses: z.number(),
  targetGlasses: z.number(),
  entries: z.array(waterEntrySchema),
  alert: hydrationAlertSchema.nullable(),
});
export type Water = z.infer<typeof waterSchema>;

export const waterResponseSchema = apiSuccessSchema(z.object({ water: waterSchema }));

export const addWaterPayloadSchema = z.object({
  day: localDaySchema,
  amountMl: z.number().int().positive(),
});
export type AddWaterPayload = z.infer<typeof addWaterPayloadSchema>;

export const deleteWaterParamsSchema = z.object({ id: idSchema });

export const updateWaterParamsSchema = z.object({ id: idSchema });
export const updateWaterPayloadSchema = z.object({
  amountMl: z.number().int().positive().optional(),
  recordedAt: isoDateSchema.optional(),
});
export type UpdateWaterPayload = z.infer<typeof updateWaterPayloadSchema>;

export const chartMetricSchema = z.enum(["calories", "water", "weight", "protein", "carbs", "fat"]);
export type ChartMetric = z.infer<typeof chartMetricSchema>;

export const chartPeriodSchema = z.enum(["7d", "14d", "1m", "1q", "6m", "1y", "all"]);
export type ChartPeriod = z.infer<typeof chartPeriodSchema>;

export const progressQuerySchema = z.object({ date: localDaySchema });

export const chartQuerySchema = z.object({
  date: localDaySchema,
  metric: chartMetricSchema,
  period: chartPeriodSchema,
});

export const waterHistoryQuerySchema = z.object({
  date: localDaySchema,
  period: chartPeriodSchema.default("7d"),
  today: localDaySchema.optional(),
});

export const waterHistoryDaySchema = z.object({
  day: localDaySchema,
  totalMl: z.number().int().nonnegative(),
  entries: z.array(waterEntrySchema),
});
export type WaterHistoryDay = z.infer<typeof waterHistoryDaySchema>;

export const waterHistoryLockedRangeSchema = z.object({
  from: localDaySchema,
  to: localDaySchema,
  lockReason: z.enum(["free_history_limit"]),
});
export type WaterHistoryLockedRange = z.infer<typeof waterHistoryLockedRangeSchema>;

export const waterHistoryResponseSchema = apiSuccessSchema(
  z.object({
    history: z.object({
      period: chartPeriodSchema,
      date: localDaySchema,
      from: localDaySchema,
      to: localDaySchema,
      days: z.array(waterHistoryDaySchema),
      lockedRange: waterHistoryLockedRangeSchema.nullable(),
      historyLimitDays: z.number().int(),
    }),
  })
);

export const weightQuerySchema = z.object({ date: localDaySchema });

export const weightEntrySchema = z.object({
  id: idSchema,
  weightKg: z.number().positive(),
  day: localDaySchema,
  recordedAt: isoDateSchema,
});
export type WeightEntry = z.infer<typeof weightEntrySchema>;

export const addWeightPayloadSchema = z.object({
  day: localDaySchema,
  weightKg: z.number().positive(),
});
export type AddWeightPayload = z.infer<typeof addWeightPayloadSchema>;

export const weightEntryResponseSchema = apiSuccessSchema(z.object({ entry: weightEntrySchema }));

export const deleteWeightParamsSchema = z.object({ id: idSchema });

export const progressSummarySchema = z.object({
  currentWeightKg: z.number().nullable(),
  targetWeightKg: z.number().nullable(),
  goalGapKg: z.number().nullable(),
  currentStreakDays: z.number().int(),
  longestStreakDays: z.number().int(),
  currentWeekAverageKcal: z.number().int(),
});

export const goalProjectionSchema = z.object({
  projectedDate: localDaySchema.nullable(),
  projectedMonth: z.string().nullable(),
  weeklyRateKg: z.number().nullable(),
  status: z.enum(["on_track", "off_track", "maintaining", "not_enough_data"]),
});
export type GoalProjection = z.infer<typeof goalProjectionSchema>;

export const calendarDaySchema = z.object({
  day: localDaySchema,
  dayOfMonth: z.number().int(),
  logged: z.boolean(),
  today: z.boolean(),
  inMonth: z.boolean(),
});

export const progressResponseSchema = apiSuccessSchema(
  z.object({
    progress: z.object({
      day: localDaySchema,
      summary: progressSummarySchema,
      projection: goalProjectionSchema,
      calendar: z.object({
        month: z.string(),
        days: z.array(calendarDaySchema),
      }),
    }),
  })
);

export const chartPointSchema = z.object({
  date: localDaySchema,
  value: z.number().nullable(),
});

export const chartResponseSchema = apiSuccessSchema(
  z.object({
    chart: z.object({
      metric: chartMetricSchema,
      period: chartPeriodSchema,
      unit: z.enum(["kcal", "ml", "kg", "g"]),
      from: localDaySchema,
      to: localDaySchema,
      points: z.array(chartPointSchema),
    }),
  })
);

export const weightContextResponseSchema = apiSuccessSchema(
  z.object({
    context: z.object({
      day: localDaySchema,
      currentWeightKg: z.number().nullable(),
      yesterdayWeightKg: z.number().nullable(),
      sevenDayAverageKg: z.number().nullable(),
      targetWeightKg: z.number().nullable(),
      projection: goalProjectionSchema,
    }),
  })
);

export const metricRoutes = {
  progressGet: {
    method: "GET",
    path: "/api/v1/metrics/progress",
    auth: "user",
  },
  chartGet: {
    method: "GET",
    path: "/api/v1/metrics/chart",
    auth: "user",
  },
  weightContextGet: {
    method: "GET",
    path: "/api/v1/metrics/weight/context",
    auth: "user",
  },
  weightAdd: {
    method: "POST",
    path: "/api/v1/metrics/weight",
    auth: "user",
  },
  weightDelete: {
    method: "DELETE",
    path: "/api/v1/metrics/weight/:id",
    auth: "user",
  },
  waterGet: {
    method: "GET",
    path: "/api/v1/metrics/water",
    auth: "user",
  },
  waterHistoryGet: {
    method: "GET",
    path: "/api/v1/metrics/water/history",
    auth: "user",
  },
  waterAdd: {
    method: "POST",
    path: "/api/v1/metrics/water",
    auth: "user",
  },
  waterDelete: {
    method: "DELETE",
    path: "/api/v1/metrics/water/:id",
    auth: "user",
  },
  waterUpdate: {
    method: "PATCH",
    path: "/api/v1/metrics/water/:id",
    auth: "user",
  },
} satisfies Record<string, RouteContract>;

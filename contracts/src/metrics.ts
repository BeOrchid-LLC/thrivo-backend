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

export const metricRoutes = {
  waterGet: {
    method: "GET",
    path: "/api/v1/metrics/water",
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
} satisfies Record<string, RouteContract>;

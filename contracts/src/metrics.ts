import { z } from "zod";
import { apiSuccessSchema, localDaySchema, type RouteContract } from "./common";

export const waterQuerySchema = z.object({ date: localDaySchema });

export const waterSchema = z.object({
  day: localDaySchema,
  totalMl: z.number(),
  targetMl: z.number(),
  glassMl: z.number(),
  glasses: z.number(),
  targetGlasses: z.number(),
});
export type Water = z.infer<typeof waterSchema>;

export const waterResponseSchema = apiSuccessSchema(z.object({ water: waterSchema }));

export const addWaterPayloadSchema = z.object({
  day: localDaySchema,
  amountMl: z.number().int().positive(),
});
export type AddWaterPayload = z.infer<typeof addWaterPayloadSchema>;

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
} satisfies Record<string, RouteContract>;

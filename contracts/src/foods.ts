import { z } from "zod";
import {
  apiSuccessSchema,
  idSchema,
  isoDateSchema,
  localDaySchema,
  type RouteContract,
} from "./common";

export const foodSourceSchema = z.enum(["barcode", "manual", "search"]);
export type FoodSource = z.infer<typeof foodSourceSchema>;

export const portionMeasureSchema = z.enum(["serving", "weight", "cup", "tbsp", "piece"]);
export type PortionMeasure = z.infer<typeof portionMeasureSchema>;

export const nutrientsSchema = z.object({
  calories: z.number(),
  proteinG: z.number(),
  carbsG: z.number(),
  fatG: z.number(),
});
export type Nutrients = z.infer<typeof nutrientsSchema>;

export const boundedNutrientsSchema = z.object({
  calories: z.number().min(0).max(5000),
  proteinG: z.number().min(0).max(500),
  carbsG: z.number().min(0).max(800),
  fatG: z.number().min(0).max(500),
});

export const servingOptionSchema = z.object({
  id: idSchema.nullable(),
  measure: portionMeasureSchema,
  label: z.string(),
  grams: z.number().nullable(),
  isDefault: z.boolean(),
});
export type ServingOption = z.infer<typeof servingOptionSchema>;

export const foodItemSchema = z.object({
  id: idSchema,
  name: z.string(),
  brand: z.string().nullable(),
  barcode: z.string().nullable(),
  source: z.enum(["authoritative", "personal", "community"]),
  servingLabel: z.string(),
  servingGrams: z.number().nullable(),
  nutrients: nutrientsSchema,
  servingOptions: z.array(servingOptionSchema),
  isPersonal: z.boolean(),
  isEstimated: z.boolean(),
});
export type FoodItem = z.infer<typeof foodItemSchema>;

export const foodLogEntrySchema = z.object({
  id: idSchema,
  foodItemId: idSchema.nullable(),
  name: z.string(),
  day: localDaySchema,
  servings: z.number().positive(),
  servingUnit: z.string().nullable(),
  source: foodSourceSchema,
  barcode: z.string().nullable(),
  isEstimated: z.boolean(),
  nutrients: nutrientsSchema,
  consumedAt: isoDateSchema,
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

export const foodLogDayQuerySchema = z.object({ date: localDaySchema });
export const foodLogDayResponseSchema = apiSuccessSchema(
  z.object({
    day: localDaySchema,
    entries: z.array(foodLogEntrySchema),
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
  entries: z.array(foodLogEntrySchema),
});
export type HistoryDay = z.infer<typeof historyDaySchema>;

export const foodLogHistoryResponseSchema = apiSuccessSchema(
  z.object({
    days: z.array(historyDaySchema),
    historyLimitDays: z.number().int(),
  })
);

export const foodLookupQuerySchema = z.object({
  barcode: z
    .string()
    .trim()
    .transform((value) => value.replace(/[\s-]/g, ""))
    .pipe(z.string().regex(/^\d{8,14}$/, "Barcode must be 8 to 14 digits")),
});
export const foodLookupResponseSchema = apiSuccessSchema(
  z.object({ food: foodItemSchema.nullable() })
);

export const foodSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(80),
  limit: z.coerce.number().int().positive().max(25).optional(),
});

export const foodSearchResultSchema = z.object({
  externalId: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  barcode: z.string().nullable(),
  servingLabel: z.string(),
  servingGrams: z.number().nullable(),
  nutrients: nutrientsSchema,
  source: z.literal("openfoodfacts"),
});
export type FoodSearchResult = z.infer<typeof foodSearchResultSchema>;

export const foodSearchResponseSchema = apiSuccessSchema(
  z.object({ items: z.array(foodSearchResultSchema), cached: z.boolean() })
);

export const foodDetailParamsSchema = z.object({ id: idSchema });
export const foodItemResponseSchema = apiSuccessSchema(z.object({ food: foodItemSchema }));

export const upsertFoodPayloadSchema = z.object({
  name: z.string().trim().min(1),
  brand: z.string().trim().optional(),
  barcode: z.string().trim().optional(),
  servingLabel: z.string().trim().min(1),
  servingGrams: z.number().positive().optional(),
  nutrients: nutrientsSchema,
});
export type UpsertFoodPayload = z.infer<typeof upsertFoodPayloadSchema>;

export const externalFoodSnapshotSchema = z.object({
  externalId: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(160),
  brand: z.string().trim().max(120).nullable().optional(),
  barcode: z.string().trim().max(32).nullable().optional(),
  servingLabel: z.string().trim().min(1).max(80),
  servingGrams: z.number().positive().nullable().optional(),
  nutrients: boundedNutrientsSchema,
  source: z.literal("openfoodfacts"),
});
export type ExternalFoodSnapshot = z.infer<typeof externalFoodSnapshotSchema>;

export const logFoodPayloadSchema = z
  .object({
    foodItemId: idSchema.optional(),
    externalFood: externalFoodSnapshotSchema.optional(),
    day: localDaySchema,
    servings: z.number().positive().max(100),
    servingId: idSchema.optional(),
    servingUnit: z.string().trim().max(80).optional(),
    consumedAt: isoDateSchema.optional(),
  })
  .superRefine((payload, ctx) => {
    if (Boolean(payload.foodItemId) === Boolean(payload.externalFood)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["foodItemId"],
        message: "Provide exactly one of foodItemId or externalFood",
      });
    }
  });
export type LogFoodPayload = z.infer<typeof logFoodPayloadSchema>;

export const storedLogFoodPayloadSchema = z.object({
  foodItemId: idSchema,
  day: localDaySchema,
  servings: z.number().positive(),
  servingId: idSchema.optional(),
  servingUnit: z.string().trim().optional(),
  consumedAt: isoDateSchema.optional(),
});

export const updateLogPayloadSchema = z.object({
  servings: z.number().positive().optional(),
  servingId: idSchema.nullable().optional(),
  servingUnit: z.string().trim().nullable().optional(),
  consumedAt: isoDateSchema.optional(),
});
export type UpdateLogPayload = z.infer<typeof updateLogPayloadSchema>;

export const logMutationResponseSchema = apiSuccessSchema(
  z.object({
    entry: foodLogEntrySchema,
    totals: dailyTotalsSchema,
  })
);

export const deleteLogParamsSchema = z.object({ id: idSchema });

export const recentFoodsQuerySchema = z.object({
  date: localDaySchema.optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
});
export const recentFoodsResponseSchema = apiSuccessSchema(
  z.object({ items: z.array(foodLogEntrySchema) })
);

export const favoritesResponseSchema = apiSuccessSchema(
  z.object({ items: z.array(foodItemSchema) })
);
export const addFavoritePayloadSchema = z.object({ foodItemId: idSchema });
export const favoriteParamsSchema = z.object({ id: idSchema });

export const estimateFoodPayloadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  ingredients: z.string().trim().max(600).optional(),
  cookingMethod: z.string().trim().max(160).optional(),
  portionMeasure: portionMeasureSchema,
  quantity: z.number().positive().max(5000),
  consumedAt: isoDateSchema.optional(),
});
export type EstimateFoodPayload = z.infer<typeof estimateFoodPayloadSchema>;

export const estimateFoodResponseSchema = apiSuccessSchema(
  z.object({
    estimate: z.object({
      name: z.string(),
      servingUnit: z.string(),
      quantity: z.number().positive(),
      nutrients: nutrientsSchema,
      isEstimated: z.literal(true),
    }),
  })
);

export const logEstimatePayloadSchema = estimateFoodPayloadSchema.extend({
  day: localDaySchema,
  nutrients: boundedNutrientsSchema,
  servingUnit: z.string().trim().max(80).optional(),
});
export type LogEstimatePayload = z.infer<typeof logEstimatePayloadSchema>;

export const foodRoutes = {
  lookup: {
    method: "GET",
    path: "/api/v1/foods/lookup",
    auth: "user",
  },
  search: {
    method: "GET",
    path: "/api/v1/foods/search",
    auth: "user",
  },
  detail: {
    method: "GET",
    path: "/api/v1/foods/:id",
    auth: "user",
  },
  create: {
    method: "POST",
    path: "/api/v1/foods",
    auth: "user",
  },
  update: {
    method: "PATCH",
    path: "/api/v1/foods/:id",
    auth: "user",
  },
  log: {
    method: "POST",
    path: "/api/v1/foods/log",
    auth: "user",
  },
  logEstimate: {
    method: "POST",
    path: "/api/v1/foods/log/estimate",
    auth: "user",
  },
  updateLog: {
    method: "PATCH",
    path: "/api/v1/foods/log/:id",
    auth: "user",
  },
  deleteLog: {
    method: "DELETE",
    path: "/api/v1/foods/log/:id",
    auth: "user",
  },
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
  recent: {
    method: "GET",
    path: "/api/v1/foods/recent",
    auth: "user",
  },
  favoritesList: {
    method: "GET",
    path: "/api/v1/foods/favorites",
    auth: "user",
  },
  favoritesAdd: {
    method: "POST",
    path: "/api/v1/foods/favorites",
    auth: "user",
  },
  favoritesRemove: {
    method: "DELETE",
    path: "/api/v1/foods/favorites/:id",
    auth: "user",
  },
  estimate: {
    method: "POST",
    path: "/api/v1/foods/estimate",
    auth: "user",
  },
} satisfies Record<string, RouteContract>;

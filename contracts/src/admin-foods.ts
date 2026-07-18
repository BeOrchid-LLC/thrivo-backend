import { z } from "zod";
import { idSchema, isoDateSchema } from "./common";
import { adminKeysetPaginated } from "./admin";

/**
 * Admin food-catalog moderation DTOs. The catalog (food_items + food_nutrients
 * + food_servings) accumulates user-created "community"/"personal" items; this
 * surface is the honesty-brand gate over them. `personal` items (owned by one
 * user) are never listed here — privacy.
 */
export const adminFoodTierSchema = z.enum(["authoritative", "community", "personal"]);
export type AdminFoodTier = z.infer<typeof adminFoodTierSchema>;

export const adminFoodStatusSchema = z.enum(["active", "pending", "rejected", "merged"]);
export type AdminFoodStatus = z.infer<typeof adminFoodStatusSchema>;

export const adminFoodOriginSchema = z.enum(["usda", "openfoodfacts", "community", "personal"]);
export type AdminFoodOrigin = z.infer<typeof adminFoodOriginSchema>;

export const adminFoodItemRowSchema = z.object({
  id: idSchema,
  name: z.string(),
  brand: z.string().nullable(),
  tier: adminFoodTierSchema,
  status: adminFoodStatusSchema,
  origin: adminFoodOriginSchema,
  barcode: z.string().nullable(),
  createdBy: idSchema.nullable(),
  verifiedAt: isoDateSchema.nullable(),
  /** Number of food_logs snapshotting this item — a merge/reject-impact signal. */
  logCount: z.number().int(),
  createdAt: isoDateSchema,
});
export type AdminFoodItemRow = z.infer<typeof adminFoodItemRowSchema>;

export const adminFoodNutrientsSchema = z.object({
  basis: z.enum(["per_100g", "per_100ml", "per_serving"]),
  servingLabel: z.string().nullable(),
  servingG: z.number().nullable(),
  kcal: z.number(),
  proteinG: z.number(),
  carbsG: z.number(),
  fatG: z.number(),
  fiberG: z.number().nullable(),
  sugarG: z.number().nullable(),
  sodiumMg: z.number().nullable(),
  satFatG: z.number().nullable(),
  novaGroup: z.number().int().nullable(),
});
export type AdminFoodNutrients = z.infer<typeof adminFoodNutrientsSchema>;

export const adminFoodServingSchema = z.object({
  id: idSchema,
  label: z.string(),
  grams: z.number(),
  isDefault: z.boolean(),
});
export type AdminFoodServing = z.infer<typeof adminFoodServingSchema>;

export const adminFoodItemDetailSchema = adminFoodItemRowSchema.extend({
  ownerUserId: idSchema.nullable(),
  mergedIntoId: idSchema.nullable(),
  nutrients: adminFoodNutrientsSchema.nullable(),
  servings: z.array(adminFoodServingSchema),
});
export type AdminFoodItemDetail = z.infer<typeof adminFoodItemDetailSchema>;

export const adminFoodListResponseSchema = adminKeysetPaginated(adminFoodItemRowSchema);
export type AdminFoodListResponse = z.infer<typeof adminFoodListResponseSchema>;

export const adminFoodDetailResponseSchema = z.object({ food: adminFoodItemDetailSchema });
export type AdminFoodDetailResponse = z.infer<typeof adminFoodDetailResponseSchema>;

// --- Moderation action payloads ---

/** Edit an item's identity and/or core macros (audited before/after). */
export const adminFoodEditPayloadSchema = z.object({
  name: z.string().min(1).optional(),
  brand: z.string().nullable().optional(),
  nutrients: z
    .object({
      kcal: z.number().nonnegative(),
      proteinG: z.number().nonnegative(),
      carbsG: z.number().nonnegative(),
      fatG: z.number().nonnegative(),
    })
    .partial()
    .optional(),
});
export type AdminFoodEditPayload = z.infer<typeof adminFoodEditPayloadSchema>;

export const adminFoodRejectPayloadSchema = z.object({ reason: z.string().min(1) });
export type AdminFoodRejectPayload = z.infer<typeof adminFoodRejectPayloadSchema>;

/** Merge this item into a canonical one. `food_logs` are already snapshotted, so
 *  history is untouched; favorites are repointed to the survivor. */
export const adminFoodMergePayloadSchema = z.object({
  mergeIntoId: idSchema,
  reason: z.string().min(1).optional(),
});
export type AdminFoodMergePayload = z.infer<typeof adminFoodMergePayloadSchema>;

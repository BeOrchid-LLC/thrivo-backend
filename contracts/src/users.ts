import { z } from "zod";
import { apiSuccessSchema, type RouteContract } from "./common";

export const goalSchema = z.enum(["lose", "maintain", "gain"]);
export const sexSchema = z.enum(["male", "female", "prefer_not_to_say"]);
export const tierSchema = z.enum(["free", "premium"]);
export const accountStatusSchema = z.enum(["dormant", "free_trial", "free_plan", "paid"]);
export const activityLevelSchema = z.enum([
  "sedentary",
  "light",
  "moderate",
  "active",
  "very_active",
]);
export const activationIntentSchema = z.enum(["skip", "start_free_trial", "complete"]);

export const userProfileSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  goal: goalSchema.nullable(),
  sex: sexSchema.nullable(),
  age: z.number().int().nullable(),
  heightCm: z.string().nullable(),
  weightKg: z.string().nullable(),
  targetWeightKg: z.string().nullable(),
  tdeeKcal: z.number().int().nullable(),
  dailyTargetKcal: z.number().int().nullable(),
  targetProteinG: z.number().int().nullable(),
  targetCarbsG: z.number().int().nullable(),
  targetFatG: z.number().int().nullable(),
  activityLevel: activityLevelSchema.nullable(),
  manualDailyTargetKcal: z.number().int().nullable(),
  notifyAt: z.string().nullable(),
  timezone: z.string().nullable(),
  tier: tierSchema,
  accountStatus: accountStatusSchema,
  trialEndsAt: z.coerce.date().nullable(),
  onboardingStep: z.number().int(),
  isOnboarded: z.boolean(),
  createdAt: z.coerce.date(),
});

export type UserProfile = z.infer<typeof userProfileSchema>;

export const getMeResponseSchema = apiSuccessSchema(userProfileSchema);

export type GetMeResponse = z.infer<typeof getMeResponseSchema>;

export const updateProfilePayloadSchema = z.object({
  firstName: z.string().trim().min(1).optional(),
  goal: goalSchema.optional(),
  currentWeightKg: z.number().positive().optional(),
  targetWeightKg: z.number().positive().optional(),
  heightCm: z.number().positive().optional(),
  ageYears: z.number().int().min(13).optional(),
  sex: sexSchema.optional(),
  activityLevel: activityLevelSchema.optional(),
  unitSystem: z.enum(["metric", "imperial"]).optional(),
  manualDailyTargetKcal: z.number().int().positive().optional(),
  notifyAt: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .optional(),
  timezone: z.string().min(1).optional(),
  onboardingStep: z.number().int().min(1).optional(),
  activationIntent: activationIntentSchema.optional(),
});

export type UpdateProfilePayload = z.infer<typeof updateProfilePayloadSchema>;

export const updateProfileResponseSchema = apiSuccessSchema(userProfileSchema);

export const deleteMeResponseSchema = z.null();

export const userRoutes = {
  getMe: {
    method: "GET",
    path: "/api/v1/users/me",
    auth: "user",
  },
  updateProfile: {
    method: "PATCH",
    path: "/api/v1/users/me/profile",
    auth: "user",
  },
  deleteMe: {
    method: "DELETE",
    path: "/api/v1/users/me",
    auth: "user",
  },
} satisfies Record<string, RouteContract>;

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
const timezoneSchema = z
  .string()
  .min(1)
  .refine(
    (timezone) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: timezone });
        return true;
      } catch {
        return false;
      }
    },
    { message: "Timezone must be a valid IANA timezone" }
  );

export const userProfileSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  image: z.string().url().nullable(),
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
  notifyTimes: z.array(z.string()).nullable(),
  timezone: z.string().nullable(),
  tier: tierSchema,
  accountStatus: accountStatusSchema,
  trialEndsAt: z.coerce.date().nullable(),
  onboardingStep: z.number().int(),
  isOnboarded: z.boolean(),
  isOnboardingSkipped: z.boolean(),
  createdAt: z.coerce.date(),
});

export type UserProfile = z.infer<typeof userProfileSchema>;

export const getMeResponseSchema = apiSuccessSchema(userProfileSchema);

export type GetMeResponse = z.infer<typeof getMeResponseSchema>;

export const updateProfilePayloadSchema = z.object({
  firstName: z.string().trim().min(1).optional(),
  // Profile avatar URL — a verified R2 public URL from the upload flow, or null
  // to clear it. Sending only `{ image }` is valid (every field is optional).
  image: z.string().url().nullable().optional(),
  goal: goalSchema.optional(),
  currentWeightKg: z.number().positive().optional(),
  targetWeightKg: z.number().positive().optional(),
  heightCm: z.number().positive().optional(),
  ageYears: z.number().int().min(13).optional(),
  sex: sexSchema.optional(),
  activityLevel: activityLevelSchema.optional(),
  unitSystem: z.enum(["metric", "imperial"]).optional(),
  manualDailyTargetKcal: z.number().int().positive().nullable().optional(),
  notifyTimes: z
    .array(z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/))
    .max(3)
    .optional(),
  timezone: timezoneSchema.optional(),
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

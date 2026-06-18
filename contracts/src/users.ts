import { z } from "zod";
import { apiSuccessSchema, type RouteContract } from "./common";

export const goalSchema = z.enum(["lose", "maintain", "gain"]);
export const sexSchema = z.enum(["male", "female"]);
export const tierSchema = z.enum(["free", "premium"]);

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
  notifyAt: z.string().nullable(),
  timezone: z.string().nullable(),
  tier: tierSchema,
  onboardingStep: z.number().int(),
  createdAt: z.coerce.date(),
});

export type UserProfile = z.infer<typeof userProfileSchema>;

export const getMeResponseSchema = apiSuccessSchema(userProfileSchema);

export type GetMeResponse = z.infer<typeof getMeResponseSchema>;

export const deleteMeResponseSchema = z.null();

export const userRoutes = {
  getMe: {
    method: "GET",
    path: "/api/v1/users/me",
    auth: "user",
  },
  deleteMe: {
    method: "DELETE",
    path: "/api/v1/users/me",
    auth: "user",
  },
} satisfies Record<string, RouteContract>;

import { z } from "zod";
import { apiSuccessSchema, type RouteContract } from "./common";

export const unitSystemSchema = z.enum(["metric", "imperial"]);
export type UnitSystem = z.infer<typeof unitSystemSchema>;

export const reminderWeekdaySchema = z.enum([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);
export type ReminderWeekday = z.infer<typeof reminderWeekdaySchema>;

const timeSchema = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);

export const globalSettingsSchema = z.object({
  key: z.literal("default"),
  pushNotificationsEnabled: z.boolean(),
  dailyFoodLogReminderEnabled: z.boolean(),
  emailFoodLogReminderEnabled: z.boolean(),
  weightCheckReminderEnabled: z.boolean(),
  hydrationReminderEnabled: z.boolean(),
  subscriptionsEnabled: z.boolean(),
  trialsEnabled: z.boolean(),
  purchasesEnabled: z.boolean(),
  cancellationsEnabled: z.boolean(),
  trialDays: z.number().int().min(1).max(90),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type GlobalSettings = z.infer<typeof globalSettingsSchema>;

export const userSettingsSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  unitSystem: unitSystemSchema,
  pushNotificationsEnabled: z.boolean(),
  dailyFoodLogReminderEnabled: z.boolean(),
  dailyFoodLogReminderTime: timeSchema,
  emailFoodLogReminderEnabled: z.boolean(),
  weightCheckReminderEnabled: z.boolean(),
  weightCheckReminderDay: reminderWeekdaySchema,
  weightCheckReminderTime: timeSchema,
  hydrationReminderEnabled: z.boolean(),
  hydrationReminderIntervalMinutes: z.number().int().min(5).max(240),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type UserSettings = z.infer<typeof userSettingsSchema>;

export const effectiveSettingsSchema = z.object({
  global: globalSettingsSchema,
  user: userSettingsSchema,
  effective: z.object({
    pushNotificationsEnabled: z.boolean(),
    dailyFoodLogReminderEnabled: z.boolean(),
    emailFoodLogReminderEnabled: z.boolean(),
    weightCheckReminderEnabled: z.boolean(),
    hydrationReminderEnabled: z.boolean(),
    subscriptionsEnabled: z.boolean(),
    trialsEnabled: z.boolean(),
    purchasesEnabled: z.boolean(),
    cancellationsEnabled: z.boolean(),
    trialDays: z.number().int(),
  }),
});
export type EffectiveSettings = z.infer<typeof effectiveSettingsSchema>;

export const updateUserSettingsPayloadSchema = z.object({
  unitSystem: unitSystemSchema.optional(),
  pushNotificationsEnabled: z.boolean().optional(),
  dailyFoodLogReminderEnabled: z.boolean().optional(),
  dailyFoodLogReminderTime: timeSchema.optional(),
  emailFoodLogReminderEnabled: z.boolean().optional(),
  weightCheckReminderEnabled: z.boolean().optional(),
  weightCheckReminderDay: reminderWeekdaySchema.optional(),
  weightCheckReminderTime: timeSchema.optional(),
  hydrationReminderEnabled: z.boolean().optional(),
  hydrationReminderIntervalMinutes: z.number().int().min(5).max(240).optional(),
});
export type UpdateUserSettingsPayload = z.infer<typeof updateUserSettingsPayloadSchema>;

export const updateGlobalSettingsPayloadSchema = z.object({
  pushNotificationsEnabled: z.boolean().optional(),
  dailyFoodLogReminderEnabled: z.boolean().optional(),
  emailFoodLogReminderEnabled: z.boolean().optional(),
  weightCheckReminderEnabled: z.boolean().optional(),
  hydrationReminderEnabled: z.boolean().optional(),
  subscriptionsEnabled: z.boolean().optional(),
  trialsEnabled: z.boolean().optional(),
  purchasesEnabled: z.boolean().optional(),
  cancellationsEnabled: z.boolean().optional(),
  trialDays: z.number().int().min(1).max(90).optional(),
});
export type UpdateGlobalSettingsPayload = z.infer<typeof updateGlobalSettingsPayloadSchema>;

export const userSettingsResponseSchema = apiSuccessSchema(userSettingsSchema);
export type UserSettingsResponse = z.infer<typeof userSettingsResponseSchema>;

export const effectiveSettingsResponseSchema = apiSuccessSchema(effectiveSettingsSchema);
export type EffectiveSettingsResponse = z.infer<typeof effectiveSettingsResponseSchema>;

export const settingsRoutes = {
  getUserSettings: {
    method: "GET",
    path: "/api/v1/users/me/settings",
    auth: "user",
  },
  updateUserSettings: {
    method: "PATCH",
    path: "/api/v1/users/me/settings",
    auth: "user",
  },
} satisfies Record<string, RouteContract>;

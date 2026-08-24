import { z } from "zod";

export const platformSchema = z.enum(["ios", "android"]);
export type Platform = z.infer<typeof platformSchema>;

export const registerPushPayload = z.object({
  expoPushToken: z
    .string()
    .regex(/^(?:Exponent|Expo)PushToken\[[^\]\r\n]+\]$/, "Invalid Expo push token"),
  platform: platformSchema,
  /** Stable app-install identifier used to retire a stale token on refresh. */
  deviceId: z.string().trim().min(1).max(255).optional(),
  /** Preferred local food-log reminder times, `HH:mm` (up to 3). */
  notifyTimes: z
    .array(z.string().regex(/^\d{2}:\d{2}$/))
    .max(3)
    .optional(),
});
export type RegisterPushPayload = z.infer<typeof registerPushPayload>;

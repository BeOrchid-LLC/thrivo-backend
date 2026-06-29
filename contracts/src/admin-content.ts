import { z } from "zod";
import { idSchema, isoDateSchema } from "./common";

/**
 * Admin content (Thrivo Tips) DTOs, promoted from the admin app's local
 * `lib/contracts/content.ts`. The tip mood set mirrors the user check-in mood
 * enum minus the wire-shape difference ("okay" here is the admin label).
 */
export const ADMIN_TIP_MOODS = ["great", "good", "okay", "low", "bad"] as const;
export type AdminTipMood = (typeof ADMIN_TIP_MOODS)[number];

export const adminTipSchema = z.object({
  id: idSchema,
  body: z.string(),
  mood: z.enum(ADMIN_TIP_MOODS).nullable(),
  isActive: z.boolean(),
  pinnedDate: isoDateSchema.nullable(),
  updatedAt: isoDateSchema,
});
export type AdminTip = z.infer<typeof adminTipSchema>;

export const adminTipResponseSchema = z.object({ tip: adminTipSchema });
export type AdminTipResponse = z.infer<typeof adminTipResponseSchema>;

export const adminUpsertTipPayloadSchema = z.object({
  body: z.string().min(1),
  mood: z.enum(ADMIN_TIP_MOODS).nullable().optional(),
  isActive: z.boolean().optional(),
  pinnedDate: z.string().nullable().optional(),
});
export type AdminUpsertTipPayload = z.infer<typeof adminUpsertTipPayloadSchema>;

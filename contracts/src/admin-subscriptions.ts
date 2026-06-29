import { z } from "zod";
import { idSchema, isoDateSchema } from "./common";
import { entitlementSchema } from "./subscriptions";
import { adminSubscriptionStatusSchema } from "./admin";

/**
 * Admin subscription-row DTO, promoted from the admin app's local
 * `lib/contracts/subscription.ts`. Reuses the shared `entitlementSchema`
 * (free | premium) and the existing `adminSubscriptionStatusSchema` from the
 * admin contract — no duplicate enums.
 */
export const adminSubscriptionRowSchema = z.object({
  id: idSchema,
  userId: idSchema,
  userEmail: z.string().email(),
  entitlement: entitlementSchema,
  status: adminSubscriptionStatusSchema,
  priceLabel: z.string().nullable(),
  upgradeTrigger: z.string().nullable(),
  startedAt: isoDateSchema.nullable(),
  renewsAt: isoDateSchema.nullable(),
});
export type AdminSubscriptionRow = z.infer<typeof adminSubscriptionRowSchema>;

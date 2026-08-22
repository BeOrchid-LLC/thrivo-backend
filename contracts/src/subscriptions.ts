import { z } from "zod";
import { apiSuccessSchema, type RouteContract } from "./common";

export const subscriptionPlanSchema = z.enum(["monthly", "annual"]);
export type SubscriptionPlan = z.infer<typeof subscriptionPlanSchema>;

export const publicSubscriptionStatusSchema = z.enum([
  "active",
  "trialing",
  "canceled",
  "expired",
  "none",
]);
export type PublicSubscriptionStatus = z.infer<typeof publicSubscriptionStatusSchema>;

export const entitlementSchema = z.enum(["free", "premium"]);
export type Entitlement = z.infer<typeof entitlementSchema>;

export const subscriptionPlanInfoSchema = z.object({
  plan: subscriptionPlanSchema,
  productId: z.string(),
  priceLabel: z.string(),
  billingPeriodLabel: z.string(),
});
export type SubscriptionPlanInfo = z.infer<typeof subscriptionPlanInfoSchema>;

export const subscriptionStateSchema = z.object({
  entitlement: entitlementSchema,
  status: publicSubscriptionStatusSchema,
  plan: subscriptionPlanSchema.nullable(),
  productId: z.string().nullable(),
  priceLabel: z.string().nullable(),
  renewsAt: z.string().nullable(),
  accessEndsAt: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  trialUsed: z.boolean(),
  trialDays: z.number().int().positive(),
  plans: z.array(subscriptionPlanInfoSchema),
  /** Whether the backend is ready to accept store purchases. */
  billingAvailable: z.boolean().default(false),
  /** Last server-to-server RevenueCat snapshot, when one exists. */
  lastSyncedAt: z.string().nullable().default(null),
});
export type SubscriptionState = z.infer<typeof subscriptionStateSchema>;

export const subscriptionResponseSchema = apiSuccessSchema(
  z.object({ subscription: subscriptionStateSchema })
);
export type SubscriptionResponse = z.infer<typeof subscriptionResponseSchema>;

export const startTrialPayloadSchema = z.object({
  plan: subscriptionPlanSchema.default("monthly"),
});
export type StartTrialPayload = z.infer<typeof startTrialPayloadSchema>;

export const purchaseSubscriptionPayloadSchema = z.object({
  plan: subscriptionPlanSchema,
});
export type PurchaseSubscriptionPayload = z.infer<typeof purchaseSubscriptionPayloadSchema>;

export const cancelSubscriptionPayloadSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
});
export type CancelSubscriptionPayload = z.infer<typeof cancelSubscriptionPayloadSchema>;

export const subscriptionRoutes = {
  getMine: {
    method: "GET",
    path: "/api/v1/subscriptions/me",
    auth: "user",
  },
  startTrial: {
    method: "POST",
    path: "/api/v1/subscriptions/trial",
    auth: "user",
  },
  purchase: {
    method: "POST",
    path: "/api/v1/subscriptions/purchase",
    auth: "user",
  },
  cancel: {
    method: "POST",
    path: "/api/v1/subscriptions/cancel",
    auth: "user",
  },
  sync: {
    method: "POST",
    path: "/api/v1/subscriptions/sync",
    auth: "user",
  },
} satisfies Record<string, RouteContract>;

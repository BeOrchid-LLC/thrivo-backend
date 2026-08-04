import { z } from "zod";
import { idSchema, isoDateSchema } from "./common";
import { adminKeysetPaginated } from "./admin";

/**
 * Admin billing observability DTOs — read-only views over the append-only
 * `subscription_events` funnel and the `webhook_events` idempotency ledger, for
 * reconciliation and dispute debugging. No money moves through this surface.
 */
export const adminSubscriptionEventTypeSchema = z.enum([
  "trial_started",
  "trial_converted",
  "trial_cancelled",
  "renewed",
  "expired",
]);
export type AdminSubscriptionEventType = z.infer<typeof adminSubscriptionEventTypeSchema>;

export const adminSubscriptionEventSchema = z.object({
  id: idSchema,
  userId: idSchema,
  userEmail: z.string().email().nullable(),
  eventType: adminSubscriptionEventTypeSchema,
  productId: z.string().nullable(),
  occurredAt: isoDateSchema,
  priceAmountCents: z.number().int().nullable(),
  currency: z.string().nullable(),
});
export type AdminSubscriptionEvent = z.infer<typeof adminSubscriptionEventSchema>;

export const adminSubscriptionEventListResponseSchema = adminKeysetPaginated(
  adminSubscriptionEventSchema
);
export type AdminSubscriptionEventListResponse = z.infer<
  typeof adminSubscriptionEventListResponseSchema
>;

/** Per-user event timeline (bounded; a plain array, newest first). */
export const adminUserBillingEventsResponseSchema = z.object({
  events: z.array(adminSubscriptionEventSchema),
});
export type AdminUserBillingEventsResponse = z.infer<typeof adminUserBillingEventsResponseSchema>;

export const adminWebhookProviderSchema = z.enum(["revenuecat", "stripe", "resend"]);
export const adminWebhookStatusSchema = z.enum(["received", "processed", "failed"]);

export const adminWebhookEventRowSchema = z.object({
  id: idSchema,
  provider: adminWebhookProviderSchema,
  eventId: z.string(),
  status: adminWebhookStatusSchema,
  receivedAt: isoDateSchema,
  processedAt: isoDateSchema.nullable(),
});
export type AdminWebhookEventRow = z.infer<typeof adminWebhookEventRowSchema>;

export const adminWebhookEventListResponseSchema = adminKeysetPaginated(adminWebhookEventRowSchema);
export type AdminWebhookEventListResponse = z.infer<typeof adminWebhookEventListResponseSchema>;

/** Detail includes the raw payload — admin-role only (may carry PII). */
export const adminWebhookEventDetailSchema = adminWebhookEventRowSchema.extend({
  payload: z.unknown(),
});
export const adminWebhookEventDetailResponseSchema = z.object({
  webhook: adminWebhookEventDetailSchema,
});
export type AdminWebhookEventDetailResponse = z.infer<typeof adminWebhookEventDetailResponseSchema>;

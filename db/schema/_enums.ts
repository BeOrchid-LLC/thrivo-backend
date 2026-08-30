import { pgEnum } from "drizzle-orm/pg-core";

// Native Postgres enums for stable value sets, so bad values can't be written.
// Declared once here because several are reused across tables.

export const userTierEnum = pgEnum("user_tier", ["free", "premium"]);
export const goalEnum = pgEnum("goal", ["lose", "maintain", "gain"]);
export const sexEnum = pgEnum("sex", ["male", "female", "prefer_not_to_say"]);
export const mealEnum = pgEnum("meal", ["breakfast", "lunch", "dinner", "snack"]);
export const logSourceEnum = pgEnum("log_source", ["barcode", "manual", "search"]);
export const moodEnum = pgEnum("mood", ["great", "good", "ok", "low", "bad"]);

export const foodTierEnum = pgEnum("food_tier", ["authoritative", "community", "personal"]);
export const foodStatusEnum = pgEnum("food_status", ["active", "pending", "rejected", "merged"]);
export const foodOriginEnum = pgEnum("food_origin", [
  "usda",
  "openfoodfacts",
  "community",
  "personal",
]);
export const nutrientBasisEnum = pgEnum("nutrient_basis", ["per_100g", "per_100ml", "per_serving"]);

export const weightSourceEnum = pgEnum("weight_source", ["manual", "healthkit", "googlefit"]);
export const platformEnum = pgEnum("platform", ["ios", "android"]);

export const subProviderEnum = pgEnum("sub_provider", ["app_store", "play_store", "stripe"]);
export const subStatusEnum = pgEnum("sub_status", [
  "none",
  "trialing",
  "active",
  "in_grace",
  "past_due",
  "canceled",
  "expired",
]);

/**
 * Append-only funnel event history (see subscription-events.ts) — distinct from
 * `subStatusEnum`, which is current-state only. Populated exclusively from
 * confirmed RevenueCat webhook deliveries in billing-webhook.service.ts.
 */
export const subscriptionEventTypeEnum = pgEnum("subscription_event_type", [
  "trial_started",
  "trial_converted",
  "trial_cancelled",
  "renewed",
  "expired",
  "canceled",
  "billing_issue",
  "refunded",
  "refund_reversed",
  "product_changed",
  "subscription_extended",
]);

/**
 * Append-only generic product-analytics events (see user-events.ts) — for
 * lifecycle moments that aren't billing-specific (contrast with
 * subscription_event_type). Receiving end only for now; nothing in this
 * codebase fires these yet (future mobile-app instrumentation).
 */
export const userEventTypeEnum = pgEnum("user_event_type", [
  "onboarding_completed",
  "upgrade_prompt_shown",
]);

export const emailStatusEnum = pgEnum("email_status", [
  "queued",
  "processing",
  "retrying",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "suppressed",
  "failed",
  "expired",
]);
export const emailKindEnum = pgEnum("email_kind", [
  "welcome",
  "weekly_review",
  "trial_ending",
  "cancellation_confirmation",
  "waitlist_confirmation",
  "admin_otp",
  "admin_invite",
  "admin_password_reset",
  "lead_contact",
  "legacy_notification",
]);
export const emailOutboxStateEnum = pgEnum("email_outbox_state", [
  "pending",
  "dispatching",
  "dispatched",
  "completed",
  "failed",
  "expired",
]);
export const emailSuppressionReasonEnum = pgEnum("email_suppression_reason", [
  "complained",
  "provider_suppressed",
  "permanent_bounce",
]);
export const webhookProviderEnum = pgEnum("webhook_provider", ["revenuecat", "stripe", "resend"]);
export const webhookStatusEnum = pgEnum("webhook_status", [
  "received",
  "processed",
  "failed",
  "quarantined",
]);

// Admin push-campaign lifecycle and per-recipient delivery state.
export const pushCampaignStatusEnum = pgEnum("push_campaign_status", [
  "draft",
  "scheduled",
  "sending",
  "sent",
  "failed",
  "canceled",
]);
export const pushRecipientStatusEnum = pgEnum("push_recipient_status", [
  "queued",
  "processing",
  "sent",
  "failed",
]);

// Object-storage upload lifecycle: a row is `pending` once a presigned URL is
// minted, `verified` after HeadObject confirms the client completed the PUT, or
// `failed`/`expired` otherwise. `uploaded` is reserved for a future webhook path.
export const uploadStatusEnum = pgEnum("upload_status", [
  "pending",
  "uploaded",
  "verified",
  "failed",
  "expired",
]);

export const leadStatusEnum = pgEnum("lead_status", [
  "new",
  "contacted",
  "qualified",
  "converted",
  "unsubscribed",
  "spam",
]);

// Derived TS unions for services / Zod contracts.
export type UserTier = (typeof userTierEnum.enumValues)[number];
export type Goal = (typeof goalEnum.enumValues)[number];
export type Sex = (typeof sexEnum.enumValues)[number];
export type Meal = (typeof mealEnum.enumValues)[number];
export type LogSource = (typeof logSourceEnum.enumValues)[number];
export type Mood = (typeof moodEnum.enumValues)[number];
export type FoodTier = (typeof foodTierEnum.enumValues)[number];
export type FoodStatus = (typeof foodStatusEnum.enumValues)[number];
export type FoodOrigin = (typeof foodOriginEnum.enumValues)[number];
export type NutrientBasis = (typeof nutrientBasisEnum.enumValues)[number];
export type WeightSource = (typeof weightSourceEnum.enumValues)[number];
export type Platform = (typeof platformEnum.enumValues)[number];
export type SubProvider = (typeof subProviderEnum.enumValues)[number];
export type SubStatus = (typeof subStatusEnum.enumValues)[number];
export type SubscriptionEventType = (typeof subscriptionEventTypeEnum.enumValues)[number];
export type UserEventType = (typeof userEventTypeEnum.enumValues)[number];
export type EmailStatus = (typeof emailStatusEnum.enumValues)[number];
export type EmailKind = (typeof emailKindEnum.enumValues)[number];
export type EmailOutboxState = (typeof emailOutboxStateEnum.enumValues)[number];
export type EmailSuppressionReason = (typeof emailSuppressionReasonEnum.enumValues)[number];
export type WebhookProvider = (typeof webhookProviderEnum.enumValues)[number];
export type WebhookStatus = (typeof webhookStatusEnum.enumValues)[number];
export type PushCampaignStatus = (typeof pushCampaignStatusEnum.enumValues)[number];
export type PushRecipientStatus = (typeof pushRecipientStatusEnum.enumValues)[number];
export type UploadStatus = (typeof uploadStatusEnum.enumValues)[number];
export type LeadStatus = (typeof leadStatusEnum.enumValues)[number];

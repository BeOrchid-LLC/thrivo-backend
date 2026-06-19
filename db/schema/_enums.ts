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
  "trialing",
  "active",
  "in_grace",
  "past_due",
  "canceled",
  "expired",
]);

export const emailStatusEnum = pgEnum("email_status", [
  "queued",
  "sent",
  "delivered",
  "bounced",
  "failed",
]);
export const webhookProviderEnum = pgEnum("webhook_provider", ["revenuecat", "stripe"]);
export const webhookStatusEnum = pgEnum("webhook_status", ["received", "processed", "failed"]);

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
export type EmailStatus = (typeof emailStatusEnum.enumValues)[number];
export type WebhookProvider = (typeof webhookProviderEnum.enumValues)[number];
export type WebhookStatus = (typeof webhookStatusEnum.enumValues)[number];

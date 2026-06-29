import { z } from "zod";
import { timePointSchema } from "./common";

/**
 * Admin analytics DTOs (promoted from the admin app's local `lib/contracts`).
 * Names are `admin`-prefixed to match the rest of the admin surface and avoid
 * collisions with the user-facing analytics/subscription schemas.
 */

export const adminDashboardMetricsSchema = z.object({
  mrrCents: z.number(),
  activeSubscribers: z.number(),
  dau: z.number(),
  mau: z.number(),
  churnRate: z.number(),
  subscriberGrowth: z.array(timePointSchema),
});
export type AdminDashboardMetrics = z.infer<typeof adminDashboardMetricsSchema>;
/** Endpoint response: `{ metrics: AdminDashboardMetrics }` (unwrapped by the API client). */
export const adminDashboardMetricsResponseSchema = z.object({
  metrics: adminDashboardMetricsSchema,
});
export type AdminDashboardMetricsResponse = z.infer<typeof adminDashboardMetricsResponseSchema>;

export const adminSubscriptionAnalyticsSchema = z.object({
  mrrCents: z.number(),
  mrrTrend: z.array(timePointSchema),
  churnTrend: z.array(timePointSchema),
  trialStarts: z.number(),
  trialConversions: z.number(),
  cancellations: z.number(),
  freeCount: z.number(),
  premiumCount: z.number(),
  upgradeTriggers: z.array(z.object({ trigger: z.string(), count: z.number() })),
});
export type AdminSubscriptionAnalytics = z.infer<typeof adminSubscriptionAnalyticsSchema>;
/** Endpoint response: `{ analytics: AdminSubscriptionAnalytics }` */
export const adminSubscriptionAnalyticsResponseSchema = z.object({
  analytics: adminSubscriptionAnalyticsSchema,
});
export type AdminSubscriptionAnalyticsResponse = z.infer<
  typeof adminSubscriptionAnalyticsResponseSchema
>;

export const adminEngagementAnalyticsSchema = z.object({
  onboardingFunnel: z.array(z.object({ step: z.string(), count: z.number() })),
  topFoods: z.array(z.object({ name: z.string(), count: z.number() })),
  averageStreakDays: z.number(),
  pushOpenRate: z.number(),
  retention: z.array(z.object({ cohort: z.string(), week: z.number(), retained: z.number() })),
});
export type AdminEngagementAnalytics = z.infer<typeof adminEngagementAnalyticsSchema>;
/** Endpoint response: `{ analytics: AdminEngagementAnalytics }` */
export const adminEngagementAnalyticsResponseSchema = z.object({
  analytics: adminEngagementAnalyticsSchema,
});
export type AdminEngagementAnalyticsResponse = z.infer<
  typeof adminEngagementAnalyticsResponseSchema
>;

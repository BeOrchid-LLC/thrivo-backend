import { z } from "zod";
import { isoDateSchema, timePointSchema } from "./common";

/**
 * Admin analytics DTOs (promoted from the admin app's local `lib/contracts`).
 * Names are `admin`-prefixed to match the rest of the admin surface and avoid
 * collisions with the user-facing analytics/subscription schemas.
 */

/**
 * Optional date-range window for the analytics endpoints. Omitted = backend's
 * default window (current behavior). `from`/`to` are ISO date strings.
 */
export const adminAnalyticsRangeSchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});
export type AdminAnalyticsRange = z.infer<typeof adminAnalyticsRangeSchema>;

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

// ---------------------------------------------------------------------------
// Admin overview page — each section below is its own endpoint, fetched
// independently by the frontend (no combined "everything" endpoint).
// ---------------------------------------------------------------------------

export const adminOverviewMetricsSchema = z.object({
  reportingCurrency: z.literal("USD").default("USD"),
  mrr: z.object({
    cents: z.number(),
    deltaPct: z.number().nullable(),
    label: z.literal("Estimated USD MRR").default("Estimated USD MRR"),
  }),
  arr: z.object({ cents: z.number(), deltaPct: z.number().nullable() }),
  premiumUsers: z.object({ total: z.number(), monthly: z.number(), annual: z.number() }),
  churnRate: z.object({ pct: z.number(), churnedMrrCents: z.number() }),
  dauMau: z.object({
    dau: z.number(),
    mau: z.number(),
    totalUsers: z.number(),
    ratioPct: z.number(),
  }),
});
export type AdminOverviewMetrics = z.infer<typeof adminOverviewMetricsSchema>;
export const adminOverviewMetricsResponseSchema = z.object({
  metrics: adminOverviewMetricsSchema,
});
export type AdminOverviewMetricsResponse = z.infer<typeof adminOverviewMetricsResponseSchema>;

export const adminOverviewRevenueTrendSchema = z.object({
  trend: z.array(timePointSchema),
  newMrrCents: z.number(),
  churnedMrrCents: z.number(),
  netNewMrrCents: z.number(),
});
export type AdminOverviewRevenueTrend = z.infer<typeof adminOverviewRevenueTrendSchema>;
export const adminOverviewRevenueTrendResponseSchema = z.object({
  revenueTrend: adminOverviewRevenueTrendSchema,
});
export type AdminOverviewRevenueTrendResponse = z.infer<
  typeof adminOverviewRevenueTrendResponseSchema
>;

export const adminOverviewTrialPipelineSchema = z.object({
  started: z.number(),
  converted: z.number(),
  convertedPct: z.number(),
  cancelled: z.number(),
  cancelledPct: z.number(),
  activePct: z.number(),
});
export type AdminOverviewTrialPipeline = z.infer<typeof adminOverviewTrialPipelineSchema>;
export const adminOverviewTrialPipelineResponseSchema = z.object({
  trialPipeline: adminOverviewTrialPipelineSchema,
});
export type AdminOverviewTrialPipelineResponse = z.infer<
  typeof adminOverviewTrialPipelineResponseSchema
>;

export const adminPlanBreakdownRowSchema = z.object({
  plan: z.enum(["monthly", "annual"]),
  priceLabel: z.string(),
  userCount: z.number(),
  mrrCents: z.number(),
});
export type AdminPlanBreakdownRow = z.infer<typeof adminPlanBreakdownRowSchema>;
export const adminOverviewPlanBreakdownSchema = z.object({
  totalPremium: z.number(),
  plans: z.array(adminPlanBreakdownRowSchema),
});
export type AdminOverviewPlanBreakdown = z.infer<typeof adminOverviewPlanBreakdownSchema>;
export const adminOverviewPlanBreakdownResponseSchema = z.object({
  planBreakdown: adminOverviewPlanBreakdownSchema,
});
export type AdminOverviewPlanBreakdownResponse = z.infer<
  typeof adminOverviewPlanBreakdownResponseSchema
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

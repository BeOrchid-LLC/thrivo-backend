import { z } from "zod";
import { idSchema, isoDateSchema } from "./common";
import { adminKeysetPaginated } from "./admin";

/**
 * Admin push-campaign DTOs. A campaign is an operator-composed one-off
 * broadcast, distinct from per-user reminder schedules and the daily tip nudge.
 * The `segment` is an audience filter resolved to active push tokens at send.
 */
export const adminPushSegmentSchema = z
  .object({
    all: z.boolean().optional(),
    tier: z.enum(["free", "premium"]).optional(),
    subscriptionStatus: z.enum(["active", "trialing", "canceled", "expired", "none"]).optional(),
    lastActiveWithinDays: z.number().int().positive().max(365).optional(),
  })
  .refine(
    (s) =>
      s.all === true ||
      s.tier !== undefined ||
      s.subscriptionStatus !== undefined ||
      s.lastActiveWithinDays !== undefined,
    { message: "Segment must target `all` or at least one filter" }
  );
export type AdminPushSegment = z.infer<typeof adminPushSegmentSchema>;

export const adminPushCampaignStatusSchema = z.enum([
  "draft",
  "scheduled",
  "sending",
  "sent",
  "failed",
  "canceled",
]);
export type AdminPushCampaignStatus = z.infer<typeof adminPushCampaignStatusSchema>;

export const adminPushCampaignRowSchema = z.object({
  id: idSchema,
  title: z.string(),
  body: z.string(),
  deepLink: z.string().nullable(),
  status: adminPushCampaignStatusSchema,
  segment: adminPushSegmentSchema,
  scheduledAt: isoDateSchema.nullable(),
  recipientCount: z.number().int(),
  sentCount: z.number().int(),
  failedCount: z.number().int(),
  sentAt: isoDateSchema.nullable(),
  createdByAdminEmail: z.string(),
  createdAt: isoDateSchema,
});
export type AdminPushCampaignRow = z.infer<typeof adminPushCampaignRowSchema>;

export const adminPushCampaignListResponseSchema = adminKeysetPaginated(adminPushCampaignRowSchema);
export type AdminPushCampaignListResponse = z.infer<typeof adminPushCampaignListResponseSchema>;

export const adminPushCampaignDetailResponseSchema = z.object({
  campaign: adminPushCampaignRowSchema,
});
export type AdminPushCampaignDetailResponse = z.infer<typeof adminPushCampaignDetailResponseSchema>;

export const adminCreateCampaignPayloadSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(500),
  deepLink: z.string().max(500).optional(),
  segment: adminPushSegmentSchema,
  /** ISO datetime for a scheduled send; omit to create a draft. */
  scheduledAt: z.string().datetime().optional(),
});
export type AdminCreateCampaignPayload = z.infer<typeof adminCreateCampaignPayloadSchema>;

/** Draft-only campaign edit. `scheduledAt: null` returns a scheduled campaign to draft. */
export const adminUpdateCampaignPayloadSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  body: z.string().min(1).max(500).optional(),
  deepLink: z.string().max(500).nullable().optional(),
  segment: adminPushSegmentSchema.optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
});
export type AdminUpdateCampaignPayload = z.infer<typeof adminUpdateCampaignPayloadSchema>;

export const adminCampaignCancelPayloadSchema = z.object({
  confirmation: z.literal("CANCEL"),
});
export type AdminCampaignCancelPayload = z.infer<typeof adminCampaignCancelPayloadSchema>;

export const adminCampaignTestPayloadSchema = z.object({
  confirmation: z.literal("SEND_TEST"),
});
export type AdminCampaignTestPayload = z.infer<typeof adminCampaignTestPayloadSchema>;

export const adminAudienceEstimatePayloadSchema = z.object({ segment: adminPushSegmentSchema });
export type AdminAudienceEstimatePayload = z.infer<typeof adminAudienceEstimatePayloadSchema>;

export const adminAudienceEstimateResponseSchema = z.object({
  userCount: z.number().int(),
  tokenCount: z.number().int(),
});
export type AdminAudienceEstimateResponse = z.infer<typeof adminAudienceEstimateResponseSchema>;

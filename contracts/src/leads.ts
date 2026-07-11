import { z } from "zod";
import type { RouteContract } from "./common";
import { idSchema, isoDateSchema } from "./common";
import { adminKeysetPaginated } from "./admin";

/**
 * Lead capture (pre-signup email captures -- "leads"). Extend this enum as new
 * capture points are added; the DB column itself stays plain text so new
 * sources don't require a migration, only a contract minor-bump.
 */
export const leadSourceSchema = z.enum(["cta", "landing", "waitlist"]);
export type LeadSource = z.infer<typeof leadSourceSchema>;

/** POST /leads/capture payload -- public, unauthenticated. */
export const leadCapturePayloadSchema = z.object({
  email: z
    .string()
    .email()
    .max(254)
    .transform((e) => e.toLowerCase()),
  source: leadSourceSchema,
  utmSource: z.string().max(255).optional(),
  utmMedium: z.string().max(255).optional(),
  utmCampaign: z.string().max(255).optional(),
});
export type LeadCapturePayload = z.infer<typeof leadCapturePayloadSchema>;

/**
 * Deliberately minimal -- identical on first submission and every resubmission,
 * so the response never reveals whether an email was already registered.
 */
export const leadCaptureResponseSchema = z.object({ captured: z.literal(true) });
export type LeadCaptureResponse = z.infer<typeof leadCaptureResponseSchema>;

/** Admin list/detail row -- full email_captures shape (minus the raw user-agent). */
export const adminLeadSchema = z.object({
  id: idSchema,
  email: z.string().email(),
  source: z.string().nullable(),
  reconciledUserId: z.string().nullable(),
  capturedAt: isoDateSchema,
  lastSubmittedAt: isoDateSchema,
  submissionCount: z.number().int(),
  country: z.string().nullable(),
  deviceType: z.string().nullable(),
  osName: z.string().nullable(),
  osVersion: z.string().nullable(),
  browserName: z.string().nullable(),
  browserVersion: z.string().nullable(),
  referrer: z.string().nullable(),
  utmSource: z.string().nullable(),
  utmMedium: z.string().nullable(),
  utmCampaign: z.string().nullable(),
});
export type AdminLead = z.infer<typeof adminLeadSchema>;

export const adminLeadListResponseSchema = adminKeysetPaginated(adminLeadSchema);
export type AdminLeadListResponse = z.infer<typeof adminLeadListResponseSchema>;

export const leadRoutes = {
  capture: {
    method: "POST",
    path: "/api/v1/leads/capture",
    auth: "public",
  },
  adminList: {
    method: "GET",
    path: "/api/v1/admin/leads",
    auth: "admin",
  },
  adminDelete: {
    method: "DELETE",
    path: "/api/v1/admin/leads/:id",
    auth: "admin",
  },
  // CSV body, not JSON -- no response schema; route metadata only.
  adminExport: {
    method: "GET",
    path: "/api/v1/admin/leads/export",
    auth: "admin",
  },
} satisfies Record<string, RouteContract>;

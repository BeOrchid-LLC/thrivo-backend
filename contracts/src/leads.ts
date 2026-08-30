import { z } from "zod";
import type { RouteContract } from "./common";
import { idSchema, isoDateSchema } from "./common";
import { adminKeysetPaginated } from "./admin";
import { adminEmailLogSchema } from "./admin-logs";

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
  status: z
    .enum(["new", "contacted", "qualified", "converted", "unsubscribed", "spam"])
    .default("new"),
  ownerAdminEmail: z.string().email().nullable().default(null),
  tags: z.array(z.string()).default([]),
  updatedAt: isoDateSchema.optional(),
});
export type AdminLead = z.infer<typeof adminLeadSchema>;

export const adminLeadStatusSchema = z.enum([
  "new",
  "contacted",
  "qualified",
  "converted",
  "unsubscribed",
  "spam",
]);
export type AdminLeadStatus = z.infer<typeof adminLeadStatusSchema>;

export const adminLeadNoteSchema = z.object({
  id: idSchema,
  leadId: idSchema,
  authorAdminEmail: z.string().email(),
  body: z.string(),
  createdAt: isoDateSchema,
});
export type AdminLeadNote = z.infer<typeof adminLeadNoteSchema>;

export const adminLeadDetailSchema = adminLeadSchema.extend({
  notes: z.array(adminLeadNoteSchema),
  linkedUser: z
    .object({
      id: idSchema,
      email: z.string().email(),
      name: z.string().nullable(),
      tier: z.enum(["free", "premium"]),
    })
    .nullable(),
  recentEmails: z.array(adminEmailLogSchema),
});
export type AdminLeadDetail = z.infer<typeof adminLeadDetailSchema>;

export const adminLeadDetailResponseSchema = z.object({ lead: adminLeadDetailSchema });
export const adminLeadNoteResponseSchema = z.object({
  lead: adminLeadDetailSchema,
  note: adminLeadNoteSchema,
});
export const adminLeadContactResponseSchema = z.object({
  lead: adminLeadDetailSchema,
  emailLogId: idSchema,
});

export const adminLeadUpdatePayloadSchema = z.object({
  status: adminLeadStatusSchema.optional(),
  ownerAdminEmail: z.string().email().nullable().optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
});

export const adminLeadNotePayloadSchema = z.object({ body: z.string().min(1).max(2_000) });

export const adminLeadContactPayloadSchema = z.object({
  template: z.literal("launch_update"),
  confirmation: z.literal("SEND"),
});

export const adminLeadLinkUserPayloadSchema = z.object({ userId: idSchema });

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
  adminDetail: { method: "GET", path: "/api/v1/admin/leads/:id", auth: "admin" },
  adminUpdate: { method: "PATCH", path: "/api/v1/admin/leads/:id", auth: "admin" },
  adminNote: { method: "POST", path: "/api/v1/admin/leads/:id/notes", auth: "admin" },
  adminContact: { method: "POST", path: "/api/v1/admin/leads/:id/contact", auth: "admin" },
  adminLinkUser: { method: "POST", path: "/api/v1/admin/leads/:id/link-user", auth: "admin" },
  // CSV body, not JSON -- no response schema; route metadata only.
  adminExport: {
    method: "GET",
    path: "/api/v1/admin/leads/export",
    auth: "admin",
  },
} satisfies Record<string, RouteContract>;

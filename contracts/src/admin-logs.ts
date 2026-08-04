import { z } from "zod";
import { idSchema, isoDateSchema } from "./common";

/**
 * Admin observability DTOs (email + audit logs), promoted from the admin app's
 * local `lib/contracts/logs.ts`.
 */
export const adminEmailLogSchema = z.object({
  id: idSchema,
  to: z.string().email(),
  template: z.string(),
  kind: z.enum([
    "welcome",
    "weekly_review",
    "trial_ending",
    "cancellation_confirmation",
    "admin_otp",
    "admin_invite",
    "admin_password_reset",
    "legacy_notification",
  ]),
  status: z.enum([
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
  ]),
  attempts: z.number().int().nonnegative(),
  providerMessageId: z.string().nullable(),
  sentAt: isoDateSchema.nullable(),
  deliveredAt: isoDateSchema.nullable(),
  failedAt: isoDateSchema.nullable(),
  failureCode: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: isoDateSchema,
});
export type AdminEmailLog = z.infer<typeof adminEmailLogSchema>;

export const adminAuditLogEntrySchema = z.object({
  id: idSchema,
  actorEmail: z.string().email(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  requestId: z.string().nullable(),
  createdAt: isoDateSchema,
});
export type AdminAuditLogEntry = z.infer<typeof adminAuditLogEntrySchema>;

// ---------------------------------------------------------------------------
// List filter query params (backend validates GET query strings with these)
// ---------------------------------------------------------------------------

/**
 * Audit-log filters. All optional — omitted = unfiltered. `from`/`to` are ISO
 * date strings bounding `createdAt`. `q` is a free-text match over actor/action/
 * target for the search box.
 */
export const adminAuditLogFilterSchema = z.object({
  actorEmail: z.string().email().optional(),
  action: z.string().optional(),
  targetType: z.string().optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  q: z.string().optional(),
});
export type AdminAuditLogFilter = z.infer<typeof adminAuditLogFilterSchema>;

/** Email-log filters. `to` is the recipient; `from`/`toDate` bound `createdAt`. */
export const adminEmailLogFilterSchema = z.object({
  status: adminEmailLogSchema.shape.status.optional(),
  template: z.string().optional(),
  kind: adminEmailLogSchema.shape.kind.optional(),
  to: z.string().optional(),
  from: isoDateSchema.optional(),
  toDate: isoDateSchema.optional(),
});
export type AdminEmailLogFilter = z.infer<typeof adminEmailLogFilterSchema>;

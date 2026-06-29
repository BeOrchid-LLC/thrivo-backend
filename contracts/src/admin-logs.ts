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
  status: z.enum(["queued", "sent", "failed", "bounced"]),
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

import { z } from "zod";
import { idSchema, isoDateSchema } from "./common";
import { adminKeysetPaginated } from "./admin";

/**
 * Admin UGC moderation DTOs. Moderation is admin-initiated (there is no user
 * report flow): operators review recent check-in notes (free text) and avatar
 * uploads (images), and can redact/restore a note or remove an image.
 */
export const adminCheckinNoteRowSchema = z.object({
  id: idSchema,
  userId: idSchema,
  userEmail: z.string().email().nullable(),
  note: z.string(),
  localDate: z.string(),
  hiddenAt: isoDateSchema.nullable(),
  createdAt: isoDateSchema,
});
export type AdminCheckinNoteRow = z.infer<typeof adminCheckinNoteRowSchema>;

export const adminCheckinNoteListResponseSchema = adminKeysetPaginated(adminCheckinNoteRowSchema);
export type AdminCheckinNoteListResponse = z.infer<typeof adminCheckinNoteListResponseSchema>;

export const adminUploadRowSchema = z.object({
  id: idSchema,
  userId: idSchema,
  userEmail: z.string().email().nullable(),
  intent: z.string(),
  publicUrl: z.string(),
  status: z.enum(["pending", "uploaded", "verified", "failed", "expired"]),
  createdAt: isoDateSchema,
});
export type AdminUploadRow = z.infer<typeof adminUploadRowSchema>;

export const adminUploadListResponseSchema = adminKeysetPaginated(adminUploadRowSchema);
export type AdminUploadListResponse = z.infer<typeof adminUploadListResponseSchema>;

/** Optional reason attached to the moderation audit entry. */
export const adminModeratePayloadSchema = z.object({ reason: z.string().max(500).optional() });
export type AdminModeratePayload = z.infer<typeof adminModeratePayloadSchema>;

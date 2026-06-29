import { z } from "zod";
import { apiSuccessSchema, type RouteContract } from "./common";

/**
 * Generic presigned-upload contract. Clients ask for a presigned PUT URL, upload
 * the bytes straight to R2, then confirm. `intent` keeps one flow reusable across
 * upload kinds — `avatar` ships now; `progress_photo`/`meal_photo` are reserved
 * for the roadmap features and rejected by the service until wired up.
 */
export const uploadIntentSchema = z.enum(["avatar", "progress_photo", "meal_photo"]);
export type UploadIntent = z.infer<typeof uploadIntentSchema>;

export const uploadStatusSchema = z.enum(["pending", "uploaded", "verified", "failed", "expired"]);
export type UploadStatus = z.infer<typeof uploadStatusSchema>;

/** Image formats accepted for image intents (avatar/photos). */
export const imageExtensionSchema = z.enum(["jpg", "jpeg", "png", "webp", "heic"]);
export type ImageExtension = z.infer<typeof imageExtensionSchema>;

export const requestUploadPayloadSchema = z.object({
  intent: uploadIntentSchema,
  fileExtension: imageExtensionSchema,
});
export type RequestUploadPayload = z.infer<typeof requestUploadPayloadSchema>;

export const requestUploadResultSchema = z.object({
  uploadId: z.string().uuid(),
  /** Presigned PUT URL — the client uploads the file bytes here. */
  uploadUrl: z.string().url(),
  /** Content-Type the client MUST send on the PUT so the signature matches. */
  contentType: z.string(),
  key: z.string(),
  /** Public read URL the object will live at once verified. */
  publicUrl: z.string().url(),
  /**
   * Server-owned max upload size in bytes for this intent. The client SHOULD
   * reject larger files before uploading; the server re-checks on verify, so a
   * tampered client can't bypass it.
   */
  maxBytes: z.number().int().positive(),
  expiresAt: z.coerce.date(),
});
export type RequestUploadResult = z.infer<typeof requestUploadResultSchema>;
export const requestUploadResponseSchema = apiSuccessSchema(requestUploadResultSchema);

export const verifyUploadResultSchema = z.object({
  uploadId: z.string().uuid(),
  status: uploadStatusSchema,
  publicUrl: z.string().url(),
  size: z.number().int().nullable(),
});
export type VerifyUploadResult = z.infer<typeof verifyUploadResultSchema>;
export const verifyUploadResponseSchema = apiSuccessSchema(verifyUploadResultSchema);

export const uploadRoutes = {
  requestUpload: {
    method: "POST",
    path: "/api/v1/uploads/presigned-url",
    auth: "user",
  },
  verifyUpload: {
    method: "POST",
    path: "/api/v1/uploads/:id/verify",
    auth: "user",
  },
} satisfies Record<string, RouteContract>;

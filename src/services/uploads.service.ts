import type {
  RequestUploadPayload,
  RequestUploadResult,
  UploadIntent,
  VerifyUploadResult,
} from "../../contracts/src/uploads";
import { uploadsRepo } from "../repositories";
import type { User } from "../repositories/user.repository";
import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { logger } from "../lib/logger";
import {
  deleteObject,
  generatePresignedUrl,
  getContentTypeFromExtension,
  IMAGE_CONTENT_TYPES,
  verifyObject,
} from "./r2.service";

const PRESIGN_TTL_SECONDS = 900; // 15 min — the client uploads immediately.

const MB = 1024 * 1024;
/** Default cap when an intent doesn't pin its own. */
const DEFAULT_MAX_BYTES = 5 * MB;
/**
 * Per-intent max upload size (bytes). Server-owned and authoritative — the client
 * is told this value but the limit is re-enforced on verify, so it can't be
 * raised by a tampered request. Profile photos are small; meal photos run larger.
 */
const INTENT_MAX_BYTES: Readonly<Record<UploadIntent, number>> = {
  avatar: 1 * MB,
  progress_photo: 5 * MB,
  meal_photo: 10 * MB,
};

/** Resolve the byte cap for an intent, falling back to the default. */
function maxBytesFor(intent: UploadIntent): number {
  return INTENT_MAX_BYTES[intent] ?? DEFAULT_MAX_BYTES;
}

function megabytes(bytes: number): string {
  return `${Math.round((bytes / MB) * 10) / 10} MB`;
}

/** Intents wired up today. Reserved roadmap intents are rejected until their columns/flows land. */
const ENABLED_INTENTS: ReadonlySet<UploadIntent> = new Set(["avatar"]);

/** Resolve the owning entity for an intent. Avatars are always owned by the caller (no IDOR). */
function entityFor(intent: UploadIntent, user: User): { entityType: string; entityId: string } {
  switch (intent) {
    case "avatar":
      return { entityType: "user", entityId: user.id };
    default:
      throw new ForbiddenError(`Uploads for intent "${intent}" are not enabled`);
  }
}

/**
 * Mint a presigned PUT URL and record a pending upload row. The client uploads
 * the bytes directly to R2, then calls `confirmUpload`.
 */
export async function requestUpload(
  user: User,
  input: RequestUploadPayload
): Promise<RequestUploadResult> {
  if (!ENABLED_INTENTS.has(input.intent)) {
    throw new ForbiddenError(`Uploads for intent "${input.intent}" are not enabled`);
  }

  const contentType = getContentTypeFromExtension(input.fileExtension);
  if (!IMAGE_CONTENT_TYPES.has(contentType)) {
    throw new ValidationError("Only image uploads are allowed for this intent");
  }

  const { entityType, entityId } = entityFor(input.intent, user);
  const presigned = await generatePresignedUrl({
    entityType,
    entityId,
    intent: input.intent,
    fileExtension: input.fileExtension,
    contentType,
    expiresIn: PRESIGN_TTL_SECONDS,
  });

  const expiresAt = new Date(Date.now() + PRESIGN_TTL_SECONDS * 1000);
  const row = await uploadsRepo.createUpload({
    userId: user.id,
    entityType,
    entityId,
    intent: input.intent,
    key: presigned.key,
    publicUrl: presigned.publicUrl,
    contentType,
    fileExtension: input.fileExtension,
    status: "pending",
    expiresAt,
  });

  return {
    uploadId: row.id,
    uploadUrl: presigned.url,
    contentType,
    key: presigned.key,
    publicUrl: presigned.publicUrl,
    maxBytes: maxBytesFor(input.intent),
    expiresAt,
  };
}

/**
 * Verify the client actually completed the PUT (HeadObject), enforce the size
 * limit, and flip the row to `verified`. Idempotent for an already-verified row.
 * On a size violation the object is deleted and the row marked failed.
 */
export async function confirmUpload(user: User, uploadId: string): Promise<VerifyUploadResult> {
  const row = await uploadsRepo.getByIdForUser(uploadId, user.id);
  if (!row) throw new NotFoundError("Upload not found");

  if (row.status === "verified") {
    return { uploadId: row.id, status: "verified", publicUrl: row.publicUrl, size: row.size };
  }

  let meta: Awaited<ReturnType<typeof verifyObject>>;
  try {
    meta = await verifyObject(row.key);
  } catch (error) {
    logger.warn({ err: error, uploadId, key: row.key }, "R2 object not found on verify");
    await uploadsRepo.markFailed(uploadId, "Object not found in storage");
    throw new NotFoundError("Uploaded file was not found in storage");
  }

  const maxBytes = maxBytesFor(row.intent as UploadIntent);
  if (meta.size !== null && meta.size > maxBytes) {
    // Reject + clean up so an oversize object never lingers or gets attached.
    await deleteObject(row.key).catch((error) =>
      logger.error({ err: error, key: row.key }, "Failed to delete oversize upload")
    );
    await uploadsRepo.markFailed(uploadId, "File exceeds the maximum allowed size");
    throw new ValidationError(`File exceeds the maximum allowed size of ${megabytes(maxBytes)}`);
  }

  const verified = await uploadsRepo.markVerified(uploadId, meta);
  if (!verified) throw new NotFoundError("Upload not found");

  return {
    uploadId: verified.id,
    status: "verified",
    publicUrl: verified.publicUrl,
    size: verified.size,
  };
}

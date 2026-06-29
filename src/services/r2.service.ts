import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { nanoid } from "nanoid";
import { env } from "../env";
import { InternalError } from "../lib/errors";
import { logger } from "../lib/logger";

/**
 * Cloudflare R2 object storage (S3-compatible). Ported from pinpoint-backend's
 * `r2.ts`, adapted to Thrivo conventions:
 *   - reads the typed, validated `env` instead of a bespoke config object;
 *   - fails at point-of-use (throws a 500 `InternalError` with an operator log)
 *     when R2 isn't configured, rather than crashing the process at boot — this
 *     matches the env policy (feature vars are optional even in production);
 *   - clients upload directly to R2 via short-lived presigned PUT URLs, so no
 *     file bytes ever transit this server (keeps the API P95 budget intact).
 */

/** R2 is enabled only when all four core credentials are present (env enforces all-or-nothing). */
export function isR2Configured(): boolean {
  return Boolean(
    env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET_NAME
  );
}

// Lazily-built singleton. Kept module-private so the only way in is through the
// exported functions, which all funnel through `requireR2()` first.
let client: S3Client | null = null;

function requireR2(): { client: S3Client; bucket: string } {
  if (!isR2Configured()) {
    logger.error(
      "R2 storage is not configured (missing R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME); object upload was attempted"
    );
    throw new InternalError("Object storage is not configured");
  }
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return { client, bucket: env.R2_BUCKET_NAME! };
}

/** Build the public URL for a stored key. CDN domain wins; public bucket URL is the fallback. */
function publicUrlForKey(key: string): string {
  const base = env.R2_CDN_URL ?? env.R2_PUBLIC_URL;
  if (!base) {
    // env.superRefine guarantees one is set whenever R2 is configured, so this is
    // defensive only.
    throw new InternalError("No R2 public URL configured");
  }
  return `${base.replace(/\/+$/, "")}/${key}`;
}

interface GeneratePresignedUrlParams {
  /** Owning entity kind, e.g. "user". First segment of the object key namespace. */
  entityType: string;
  /** Owning entity id, e.g. the user id. */
  entityId: string;
  /** What the object is for, e.g. "avatar". Lets one bucket host many upload kinds. */
  intent: string;
  /** File extension without the dot, e.g. "jpg". Appended to the generated name. */
  fileExtension?: string;
  contentType?: string;
  /** Presigned URL lifetime in seconds. Default 15 min — short, since the client uploads immediately. */
  expiresIn?: number;
}

export interface PresignedUpload {
  filename: string;
  key: string;
  /** Presigned PUT URL the client uploads the bytes to. */
  url: string;
  /** Public read URL the object will be reachable at once uploaded. */
  publicUrl: string;
}

/**
 * Mint a presigned PUT URL for a direct client→R2 upload.
 * Key layout: `{FOLDER_PREFIX}/{entityType}/{entityId}/{intent}/{nanoid}.{ext}`.
 */
export async function generatePresignedUrl({
  entityType,
  entityId,
  intent,
  fileExtension = "",
  contentType = "application/octet-stream",
  expiresIn = 900,
}: GeneratePresignedUrlParams): Promise<PresignedUpload> {
  const { client: r2, bucket } = requireR2();

  const ext = fileExtension.replace(/^\./, "");
  const filename = `${nanoid()}${ext ? `.${ext}` : ""}`;
  const key = `${env.R2_FOLDER_PREFIX}/${entityType}/${entityId}/${intent}/${filename}`;

  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType });
  const url = await getSignedUrl(r2, command, { expiresIn });

  return { filename, key, url, publicUrl: publicUrlForKey(key) };
}

export interface VerifiedObject {
  size: number | null;
  contentType: string | null;
}

/**
 * Confirm an object exists in R2 and read its metadata (size, content-type)
 * without downloading it. Used after a presigned upload to verify the client
 * actually completed the PUT.
 */
export async function verifyObject(key: string): Promise<VerifiedObject> {
  const { client: r2, bucket } = requireR2();
  const result = await r2.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  return {
    size: result.ContentLength ?? null,
    contentType: result.ContentType ?? null,
  };
}

/** Best-effort delete. Logs and rethrows on failure so callers can decide whether to swallow. */
export async function deleteObject(key: string): Promise<void> {
  const { client: r2, bucket } = requireR2();
  try {
    await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    logger.error({ err: error, key }, "Failed to delete object from R2");
    throw error;
  }
}

/**
 * Recover the object key from a stored public URL. Returns null for URLs that
 * aren't ours (e.g. external Google OAuth avatar URLs), so callers can safely
 * skip deleting non-R2 images.
 */
export function extractKeyFromUrl(url: string): string | null {
  for (const base of [env.R2_CDN_URL, env.R2_PUBLIC_URL]) {
    if (base && url.startsWith(base)) {
      return url.slice(base.replace(/\/+$/, "").length + 1);
    }
  }
  if (env.R2_BUCKET_NAME) {
    const match = url.match(new RegExp(`${env.R2_BUCKET_NAME}/(.+)`));
    if (match) return match[1] ?? null;
  }
  return null;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  // Images
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  heic: "image/heic",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  // Documents
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // Video
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
  m4v: "video/x-m4v",
};

/** Map a file extension to a content-type, defaulting to a generic binary type. */
export function getContentTypeFromExtension(extension: string): string {
  const ext = extension.toLowerCase().replace(/^\./, "");
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/** Allowlisted image content-types accepted for avatar/photo intents. */
export const IMAGE_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
]);

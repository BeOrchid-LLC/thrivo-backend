import type { Context } from "hono";
import { z } from "zod";
import { adminModeratePayloadSchema } from "../../contracts/src/admin-moderation";
import { NotFoundError } from "../lib/errors";
import { respondOk } from "../lib/response";
import { getClientIp } from "../lib/request-ip";
import { adminModerationRepo } from "../repositories";
import type { AuditActor } from "../repositories/admin-audit-log.repository";
import type { AppEnv } from "../types/http";

const noteListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  userId: z.string().optional(),
  q: z.string().optional(),
  hiddenOnly: z
    .enum(["1", "true", "yes"])
    .transform(() => true)
    .optional(),
});

const uploadListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  userId: z.string().optional(),
  q: z.string().optional(),
});

function auditActor(c: Context<AppEnv>): AuditActor {
  return {
    actorAdminEmail: c.get("adminUser")!.email,
    requestId: c.get("requestId") ?? null,
    ip: getClientIp(c),
  };
}

async function optionalReason(c: Context<AppEnv>): Promise<string | undefined> {
  // Body is optional for these actions; tolerate an empty/missing/invalid payload.
  try {
    const parsed = adminModeratePayloadSchema.safeParse(await c.req.json());
    return parsed.success ? parsed.data.reason : undefined;
  } catch {
    return undefined;
  }
}

/** GET /admin/moderation/checkin-notes — keyset list of notes, with optional filters. */
export async function listAdminCheckinNotes(c: Context<AppEnv>) {
  const { cursor, limit, userId, q, hiddenOnly } = noteListQuerySchema.parse(c.req.query());
  const r = await adminModerationRepo.listCheckinNotesPaged({
    cursor,
    limit,
    userId,
    q,
    hiddenOnly,
  });
  return respondOk(c, {
    items: r.items,
    pagination: { limit: r.limit, total: r.total, nextCursor: r.nextCursor },
  });
}

/** POST /admin/checkins/:id/redact — hide a note from the mobile read (support+). */
export async function redactAdminCheckinNote(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const ok = await adminModerationRepo.setNoteHidden(
    id,
    true,
    auditActor(c),
    await optionalReason(c)
  );
  if (!ok) throw new NotFoundError("Check-in not found");
  return respondOk(c, null, "Note redacted");
}

/** POST /admin/checkins/:id/restore — un-hide a previously redacted note (support+). */
export async function restoreAdminCheckinNote(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const ok = await adminModerationRepo.setNoteHidden(
    id,
    false,
    auditActor(c),
    await optionalReason(c)
  );
  if (!ok) throw new NotFoundError("Check-in not found");
  return respondOk(c, null, "Note restored");
}

/** GET /admin/moderation/uploads — keyset list of live avatar uploads, with optional filters. */
export async function listAdminUploads(c: Context<AppEnv>) {
  const { cursor, limit, userId, q } = uploadListQuerySchema.parse(c.req.query());
  const r = await adminModerationRepo.listUploadsPaged({ cursor, limit, userId, q });
  return respondOk(c, {
    items: r.items,
    pagination: { limit: r.limit, total: r.total, nextCursor: r.nextCursor },
  });
}

/** POST /admin/uploads/:id/remove — soft-delete an avatar + clear the profile image (admin-only). */
export async function removeAdminUpload(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const ok = await adminModerationRepo.removeUpload(id, auditActor(c), await optionalReason(c));
  if (!ok) throw new NotFoundError("Upload not found");
  return respondOk(c, null, "Upload removed");
}

/** POST /admin/uploads/:id/restore — undo a prior remove (support+). */
export async function restoreAdminUpload(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const ok = await adminModerationRepo.restoreUpload(id, auditActor(c), await optionalReason(c));
  if (!ok) throw new NotFoundError("Upload not found or not removed");
  return respondOk(c, null, "Upload restored");
}

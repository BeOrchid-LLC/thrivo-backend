import { and, count, desc, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import { db } from "../../db";
import { checkIns, uploads, users, type UploadStatus } from "../../db/schema";
import type { AdminCheckinNoteRow, AdminUploadRow } from "../../contracts/src/admin-moderation";
import * as adminAuditLogRepo from "./admin-audit-log.repository";
import type { AuditActor } from "./admin-audit-log.repository";
import { clampLimit, decodeCursor, encodeCursor } from "../lib/pagination";

// --- Check-in notes ---

function toNoteRow(r: {
  id: string;
  userId: string;
  userEmail: string | null;
  note: string | null;
  localDate: string;
  hiddenAt: Date | null;
  createdAt: Date;
}): AdminCheckinNoteRow {
  return {
    id: r.id,
    userId: r.userId,
    userEmail: r.userEmail,
    note: r.note ?? "",
    localDate: r.localDate,
    hiddenAt: r.hiddenAt ? r.hiddenAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

type NoteCursor = { createdAt: string; id: string };

/** Keyset list of recent non-empty check-in notes (newest first). */
export async function listCheckinNotesPaged(params: { cursor?: string; limit?: number }): Promise<{
  items: AdminCheckinNoteRow[];
  limit: number;
  total: number;
  nextCursor: string | null;
}> {
  const limit = clampLimit(params.limit, 20, 100);
  const base = and(sql`${checkIns.note} is not null`, ne(checkIns.note, ""));
  const cursorWhere: SQL | undefined = params.cursor
    ? (() => {
        const c = decodeCursor<NoteCursor>(params.cursor!);
        return sql`(${checkIns.createdAt}, ${checkIns.id}) < (${c.createdAt}::timestamptz, ${c.id})`;
      })()
    : undefined;

  const [rows, [{ value: total }]] = await Promise.all([
    db
      .select({
        id: checkIns.id,
        userId: checkIns.userId,
        userEmail: users.email,
        note: checkIns.note,
        localDate: checkIns.localDate,
        hiddenAt: checkIns.hiddenAt,
        createdAt: checkIns.createdAt,
        createdAtCursor: sql<string>`${checkIns.createdAt}::text`,
      })
      .from(checkIns)
      .leftJoin(users, eq(users.id, checkIns.userId))
      .where(and(base, cursorWhere))
      .orderBy(desc(checkIns.createdAt), desc(checkIns.id))
      .limit(limit),
    db.select({ value: count() }).from(checkIns).where(base),
  ]);

  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === limit && last
      ? encodeCursor({ createdAt: last.createdAtCursor, id: last.id } satisfies NoteCursor)
      : null;

  return { items: rows.map(toNoteRow), limit, total: Number(total), nextCursor };
}

/** Redact (hiddenAt=now) or restore (hiddenAt=null) a note. Audited. */
export async function setNoteHidden(
  id: string,
  hidden: boolean,
  audit: AuditActor,
  reason?: string
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(checkIns).where(eq(checkIns.id, id)).limit(1);
    if (!before) return false;

    await tx
      .update(checkIns)
      .set({ hiddenAt: hidden ? new Date() : null })
      .where(eq(checkIns.id, id));

    await adminAuditLogRepo.append(
      {
        actorAdminEmail: audit.actorAdminEmail,
        action: hidden ? "checkin_note.redact" : "checkin_note.restore",
        targetType: "check_in",
        targetId: id,
        before: { hiddenAt: before.hiddenAt, note: before.note },
        after: { hidden, reason: reason ?? null },
        requestId: audit.requestId,
        ip: audit.ip,
      },
      tx
    );
    return true;
  });
}

// --- Avatar / uploads ---

function toUploadRow(r: {
  id: string;
  userId: string;
  userEmail: string | null;
  intent: string;
  publicUrl: string;
  status: UploadStatus;
  createdAt: Date;
}): AdminUploadRow {
  return {
    id: r.id,
    userId: r.userId,
    userEmail: r.userEmail,
    intent: r.intent,
    publicUrl: r.publicUrl,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  };
}

type UploadCursor = { createdAt: string; id: string };

/** Keyset list of live avatar uploads (newest first). */
export async function listUploadsPaged(params: {
  cursor?: string;
  limit?: number;
}): Promise<{ items: AdminUploadRow[]; limit: number; total: number; nextCursor: string | null }> {
  const limit = clampLimit(params.limit, 20, 100);
  const base = and(
    eq(uploads.intent, "avatar"),
    inArray(uploads.status, ["verified", "uploaded"] satisfies UploadStatus[]),
    isNull(uploads.deletedAt)
  );
  const cursorWhere: SQL | undefined = params.cursor
    ? (() => {
        const c = decodeCursor<UploadCursor>(params.cursor!);
        return sql`(${uploads.createdAt}, ${uploads.id}) < (${c.createdAt}::timestamptz, ${c.id})`;
      })()
    : undefined;

  const [rows, [{ value: total }]] = await Promise.all([
    db
      .select({
        id: uploads.id,
        userId: uploads.userId,
        userEmail: users.email,
        intent: uploads.intent,
        publicUrl: uploads.publicUrl,
        status: uploads.status,
        createdAt: uploads.createdAt,
        createdAtCursor: sql<string>`${uploads.createdAt}::text`,
      })
      .from(uploads)
      .leftJoin(users, eq(users.id, uploads.userId))
      .where(and(base, cursorWhere))
      .orderBy(desc(uploads.createdAt), desc(uploads.id))
      .limit(limit),
    db.select({ value: count() }).from(uploads).where(base),
  ]);

  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === limit && last
      ? encodeCursor({ createdAt: last.createdAtCursor, id: last.id } satisfies UploadCursor)
      : null;

  return { items: rows.map(toUploadRow), limit, total: Number(total), nextCursor };
}

/**
 * Soft-delete an avatar upload and clear the owner's profile image if it still
 * points at this object. Audited. R2 object deletion is a follow-up worker job;
 * this makes the image stop being served/referenced immediately.
 */
export async function removeUpload(
  id: string,
  audit: AuditActor,
  reason?: string
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(uploads).where(eq(uploads.id, id)).limit(1);
    if (!before || before.deletedAt) return false;

    await tx.update(uploads).set({ deletedAt: new Date() }).where(eq(uploads.id, id));
    await tx
      .update(users)
      .set({ image: null })
      .where(and(eq(users.id, before.userId), eq(users.image, before.publicUrl)));

    await adminAuditLogRepo.append(
      {
        actorAdminEmail: audit.actorAdminEmail,
        action: "upload.remove",
        targetType: "upload",
        targetId: id,
        before: { userId: before.userId, publicUrl: before.publicUrl, status: before.status },
        after: { reason: reason ?? null },
        requestId: audit.requestId,
        ip: audit.ip,
      },
      tx
    );
    return true;
  });
}

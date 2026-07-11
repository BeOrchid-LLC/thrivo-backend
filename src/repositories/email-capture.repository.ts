import { and, count, desc, eq, getTableColumns, ilike, sql } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { emailCaptures, type EmailCaptureRow } from "../../db/schema";
import type { AdminLead } from "../../contracts/src/leads";
import * as adminAuditLogRepo from "./admin-audit-log.repository";
import type { AuditActor } from "./admin-audit-log.repository";
import { clampLimit, decodeCursor, encodeCursor } from "../lib/pagination";

export type EmailCapture = EmailCaptureRow;

/** Maps a DB row to the admin-facing DTO -- deliberately drops rawUserAgent (operational/debug data, not part of the contract surface). */
function toAdminLead(row: EmailCaptureRow): AdminLead {
  return {
    id: row.id,
    email: row.email,
    source: row.source,
    reconciledUserId: row.reconciledUserId,
    capturedAt: row.capturedAt.toISOString(),
    lastSubmittedAt: row.lastSubmittedAt.toISOString(),
    submissionCount: row.submissionCount,
    country: row.country,
    deviceType: row.deviceType,
    osName: row.osName,
    osVersion: row.osVersion,
    browserName: row.browserName,
    browserVersion: row.browserVersion,
    referrer: row.referrer,
    utmSource: row.utmSource,
    utmMedium: row.utmMedium,
    utmCampaign: row.utmCampaign,
  };
}

export type CaptureInput = {
  email: string;
  source: string;
  country: string | null;
  deviceType: string | null;
  osName: string | null;
  osVersion: string | null;
  browserName: string | null;
  browserVersion: string | null;
  rawUserAgent: string | null;
  referrer: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
};

/**
 * Upsert on email (unique). First submission inserts with submissionCount=1.
 * A resubmission refreshes metadata (country/device/referrer/UTM may change
 * across visits) and bumps submissionCount/lastSubmittedAt in place -- id and
 * capturedAt (first-seen) are never overwritten, and reconciledUserId isn't
 * touched here (see reconcileToUser). Atomic single statement so concurrent
 * duplicate submissions can't race each other.
 */
export async function capture(input: CaptureInput, tx: Executor = db): Promise<EmailCapture> {
  const [row] = await tx
    .insert(emailCaptures)
    .values({ ...input, submissionCount: 1 })
    .onConflictDoUpdate({
      target: emailCaptures.email,
      set: {
        source: input.source,
        country: input.country,
        deviceType: input.deviceType,
        osName: input.osName,
        osVersion: input.osVersion,
        browserName: input.browserName,
        browserVersion: input.browserVersion,
        rawUserAgent: input.rawUserAgent,
        referrer: input.referrer,
        utmSource: input.utmSource,
        utmMedium: input.utmMedium,
        utmCampaign: input.utmCampaign,
        submissionCount: sql`${emailCaptures.submissionCount} + 1`,
        lastSubmittedAt: sql`now()`,
      },
    })
    .returning();
  return row;
}

/** Link a lead to a user when they sign up (reconciliation by email). */
export async function reconcileToUser(
  email: string,
  userId: string,
  tx: Executor = db
): Promise<void> {
  await tx
    .update(emailCaptures)
    .set({ reconciledUserId: userId })
    .where(eq(emailCaptures.email, email));
}

export type ListParams = {
  /** Opaque cursor from a previous page's `nextCursor` — omit for the first page. */
  cursor?: string;
  limit?: number;
  search?: string;
};
export type ListResult = {
  items: AdminLead[];
  pagination: { limit: number; total: number; nextCursor: string | null };
};

type LeadCursor = { capturedAt: string; id: string };

/**
 * `(captured_at, id) < cursor` as a row-value comparison — one indexed seek
 * (email_captures_captured_at_id_idx) per page, never an OFFSET scan-and-discard
 * (SYSTEM_DESIGN §373; R5-4/I16). The cursor's `captured_at` carries the
 * column's raw `::text` cast (not a JS `Date`, which is millisecond-precision
 * only against Postgres's microsecond `timestamptz` — see the identical note
 * on `admin-user.repository.ts`'s `buildCursorWhere`), compared back against
 * the bare column so the `email_captures_captured_at_id_idx` index stays
 * usable.
 */
function buildCursorWhere(cursor: LeadCursor) {
  return sql`(${emailCaptures.capturedAt}, ${emailCaptures.id}) < (${cursor.capturedAt}::timestamptz, ${cursor.id})`;
}

/** Admin list — keyset-paginated, newest-first, optional email search. */
export async function list(params: ListParams): Promise<ListResult> {
  const { search } = params;
  const limit = clampLimit(params.limit, 20, 100);
  const searchWhere = search ? ilike(emailCaptures.email, `%${search}%`) : undefined;
  const cursorWhere = params.cursor
    ? buildCursorWhere(decodeCursor<LeadCursor>(params.cursor))
    : undefined;

  const [rows, [{ value: total }]] = await Promise.all([
    db
      .select({
        ...getTableColumns(emailCaptures),
        capturedAtCursor: sql<string>`${emailCaptures.capturedAt}::text`,
      })
      .from(emailCaptures)
      .where(and(searchWhere, cursorWhere))
      .orderBy(desc(emailCaptures.capturedAt), desc(emailCaptures.id))
      .limit(limit),
    db.select({ value: count() }).from(emailCaptures).where(searchWhere),
  ]);

  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === limit && last
      ? encodeCursor({
          capturedAt: last.capturedAtCursor,
          id: last.id,
        } satisfies LeadCursor)
      : null;

  return {
    items: rows.map(toAdminLead),
    pagination: { limit, total: Number(total), nextCursor },
  };
}

/** Every row, newest-first -- backs the admin CSV export (small table, no pagination needed). */
export async function listAll(): Promise<EmailCapture[]> {
  return db.select().from(emailCaptures).orderBy(desc(emailCaptures.capturedAt));
}

/**
 * Hard delete for admin spam/bad-email cleanup. Writes the `admin_audit_log` row
 * in the same transaction (before-snapshot of the full row) so a rolled-back
 * delete leaves no orphan audit entry and vice-versa. Returns true if a row
 * existed and was deleted.
 */
export async function hardDelete(id: string, audit: AuditActor): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(emailCaptures).where(eq(emailCaptures.id, id)).limit(1);
    if (!row) return false;

    await tx.delete(emailCaptures).where(eq(emailCaptures.id, id));

    await adminAuditLogRepo.append(
      {
        actorAdminEmail: audit.actorAdminEmail,
        action: "lead.hard_delete",
        targetType: "lead",
        targetId: id,
        before: row,
        requestId: audit.requestId,
        ip: audit.ip,
      },
      tx
    );
    return true;
  });
}

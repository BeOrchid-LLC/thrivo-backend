import { count, desc, eq, ilike, sql } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { emailCaptures, type EmailCaptureRow } from "../../db/schema";
import type { AdminLead } from "../../contracts/src/leads";
import * as adminAuditLogRepo from "./admin-audit-log.repository";
import type { AuditActor } from "./admin-audit-log.repository";

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

export type ListParams = { page: number; pageSize: number; search?: string };
export type ListResult = {
  items: AdminLead[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

/** Admin list — paginated, newest-first, optional email search. */
export async function list(params: ListParams): Promise<ListResult> {
  const { page, pageSize, search } = params;
  const offset = (page - 1) * pageSize;
  const where = search ? ilike(emailCaptures.email, `%${search}%`) : undefined;

  const [rows, [{ value: total }]] = await Promise.all([
    db
      .select()
      .from(emailCaptures)
      .where(where)
      .orderBy(desc(emailCaptures.capturedAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ value: count() }).from(emailCaptures).where(where),
  ]);

  return {
    items: rows.map(toAdminLead),
    pagination: {
      page,
      pageSize,
      total: Number(total),
      totalPages: Math.max(1, Math.ceil(Number(total) / pageSize)),
    },
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

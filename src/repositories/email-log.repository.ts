import { and, count, desc, eq, gte, ilike, inArray, lte, sql, type SQL } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import {
  emailLogs,
  type EmailLogRow,
  type EmailKind,
  type EmailStatus,
  type NewEmailLogRow,
} from "../../db/schema";

export type EmailLog = EmailLogRow;

export type ListEmailLogParams = {
  offset: number;
  limit: number;
  status?: EmailStatus;
  kind?: EmailKind;
  template?: string;
  toEmail?: string;
  from?: Date;
  to?: Date;
};

/** Admin viewer — offset-paginated, newest-first, with optional filters. */
export async function listPaged(
  params: ListEmailLogParams,
  tx: Executor = db
): Promise<{ rows: EmailLog[]; total: number }> {
  const clauses: (SQL | undefined)[] = [
    params.status ? eq(emailLogs.status, params.status) : undefined,
    params.kind ? eq(emailLogs.kind, params.kind) : undefined,
    params.template ? eq(emailLogs.template, params.template) : undefined,
    params.toEmail ? ilike(emailLogs.toEmail, `%${params.toEmail}%`) : undefined,
    params.from ? gte(emailLogs.createdAt, params.from) : undefined,
    params.to ? lte(emailLogs.createdAt, params.to) : undefined,
  ];
  const where = and(...clauses);
  const [rows, [{ value: total }]] = await Promise.all([
    tx
      .select()
      .from(emailLogs)
      .where(where)
      .orderBy(desc(emailLogs.createdAt), desc(emailLogs.id))
      .limit(params.limit)
      .offset(params.offset),
    tx.select({ value: count() }).from(emailLogs).where(where),
  ]);
  return { rows, total: Number(total) };
}

export async function logSend(input: NewEmailLogRow, tx: Executor = db): Promise<EmailLog> {
  const [row] = await tx.insert(emailLogs).values(input).returning();
  return row;
}

/** Insert a logical send, or return the existing row for its semantic dedupe key. */
export async function logSendIdempotent(
  input: NewEmailLogRow,
  tx: Executor = db
): Promise<{ row: EmailLog; created: boolean }> {
  const [created] = await tx.insert(emailLogs).values(input).onConflictDoNothing().returning();
  if (created) return { row: created, created: true };
  if (!input.dedupeKey || !input.kind)
    throw new Error("Email log insert conflicted without dedupe key");
  const [existing] = await tx
    .select()
    .from(emailLogs)
    .where(and(eq(emailLogs.kind, input.kind), eq(emailLogs.dedupeKey, input.dedupeKey)))
    .limit(1);
  if (!existing) throw new Error("Email dedupe conflict row unavailable");
  return { row: existing, created: false };
}

export async function findById(id: string, tx: Executor = db): Promise<EmailLog | null> {
  const [row] = await tx.select().from(emailLogs).where(eq(emailLogs.id, id)).limit(1);
  return row ?? null;
}

export async function findByProviderMessageId(
  providerMessageId: string,
  tx: Executor = db
): Promise<EmailLog | null> {
  const [row] = await tx
    .select()
    .from(emailLogs)
    .where(eq(emailLogs.providerMessageId, providerMessageId))
    .limit(1);
  return row ?? null;
}

export async function updateStatus(
  id: string,
  status: EmailStatus,
  fields: Partial<NewEmailLogRow> = {},
  tx: Executor = db
): Promise<void> {
  await tx
    .update(emailLogs)
    .set({ status, ...fields })
    .where(eq(emailLogs.id, id));
}

export async function markAttempt(
  id: string,
  status: "processing" | "retrying",
  fields: { error?: string | null; failureCode?: string | null } = {},
  tx: Executor = db
): Promise<void> {
  await tx
    .update(emailLogs)
    .set({
      status,
      attemptCount: sql`${emailLogs.attemptCount} + 1`,
      lastAttemptAt: new Date(),
      error: fields.error,
      failureCode: fields.failureCode,
    })
    .where(eq(emailLogs.id, id));
}

export async function markSent(
  id: string,
  providerMessageId: string,
  tx: Executor = db
): Promise<void> {
  await tx
    .update(emailLogs)
    .set({
      status: "sent",
      providerMessageId,
      sentAt: new Date(),
      error: null,
      failureCode: null,
      failedAt: null,
    })
    .where(eq(emailLogs.id, id));
}

export async function markTerminalFailure(
  id: string,
  status: "failed" | "suppressed" | "expired",
  failureCode: string,
  error?: string,
  tx: Executor = db
): Promise<void> {
  await tx
    .update(emailLogs)
    .set({ status, failureCode, error: error?.slice(0, 500) ?? null, failedAt: new Date() })
    .where(eq(emailLogs.id, id));
}

const adverseStatuses: EmailStatus[] = ["bounced", "complained", "suppressed"];

/** Apply provider events without allowing late lower-priority events to downgrade state. */
export async function applyProviderEvent(
  providerMessageId: string,
  status: "sent" | "delivered" | "bounced" | "complained" | "suppressed" | "failed",
  eventAt: Date,
  tx: Executor = db
): Promise<EmailLog | null> {
  const current = await findByProviderMessageId(providerMessageId, tx);
  if (!current) return null;
  if (current.providerEventAt && current.providerEventAt > eventAt) return current;
  if (adverseStatuses.includes(current.status) && !adverseStatuses.includes(status)) return current;
  if (current.status === "delivered" && (status === "sent" || status === "failed")) return current;

  const [updated] = await tx
    .update(emailLogs)
    .set({
      status,
      providerEventAt: eventAt,
      deliveredAt: status === "delivered" ? eventAt : current.deliveredAt,
      failedAt:
        status === "failed" || adverseStatuses.includes(status) ? eventAt : current.failedAt,
      failureCode: status === "failed" ? "provider_failed" : current.failureCode,
    })
    .where(eq(emailLogs.id, current.id))
    .returning();
  return updated ?? current;
}

export async function listForUser(userId: string, tx: Executor = db): Promise<EmailLog[]> {
  return tx
    .select()
    .from(emailLogs)
    .where(eq(emailLogs.userId, userId))
    .orderBy(desc(emailLogs.createdAt));
}

/**
 * Dedupe guard for scheduled sends (e.g. weekly-review): true if `template`
 * was already logged for this user since `sinceDate`. A cron that reprocesses
 * the same user twice (manual retrigger, a timezone bucket matching more than
 * once around a DST transition) should not double-send.
 */
export async function hasRecentSend(
  userId: string,
  template: string,
  sinceDate: Date,
  tx: Executor = db
): Promise<boolean> {
  const [row] = await tx
    .select({ id: emailLogs.id })
    .from(emailLogs)
    .where(
      and(
        eq(emailLogs.userId, userId),
        eq(emailLogs.template, template),
        gte(emailLogs.createdAt, sinceDate)
      )
    )
    .limit(1);
  return row !== undefined;
}
/** Return the users with a recent send for one template in a single indexed query. */
export async function listRecentSends(
  userIds: string[],
  template: string,
  sinceDate: Date,
  tx: Executor = db
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();

  const rows = await tx
    .select({ userId: emailLogs.userId })
    .from(emailLogs)
    .where(
      and(
        inArray(emailLogs.userId, userIds),
        eq(emailLogs.template, template),
        gte(emailLogs.createdAt, sinceDate)
      )
    );

  return new Set(rows.flatMap((row) => (row.userId ? [row.userId] : [])));
}

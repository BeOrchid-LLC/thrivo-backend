import { and, count, desc, eq, gte, ilike, lte, or, type SQL } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { adminAuditLog, type AdminAuditLogRow, type NewAdminAuditLogRow } from "../../db/schema";
import { sanitizeAuditMetadata } from "../lib/audit-metadata";

export type AdminAuditLog = AdminAuditLogRow;

export type ListAuditLogParams = {
  offset: number;
  limit: number;
  actorEmail?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  requestId?: string;
  from?: Date;
  to?: Date;
  q?: string;
};

/** Admin viewer — offset-paginated, newest-first, with optional filters. */
export async function listPaged(
  params: ListAuditLogParams,
  tx: Executor = db
): Promise<{ rows: AdminAuditLog[]; total: number }> {
  const clauses: (SQL | undefined)[] = [
    params.actorEmail ? eq(adminAuditLog.actorAdminEmail, params.actorEmail) : undefined,
    params.action ? eq(adminAuditLog.action, params.action) : undefined,
    params.targetType ? eq(adminAuditLog.targetType, params.targetType) : undefined,
    params.targetId ? eq(adminAuditLog.targetId, params.targetId) : undefined,
    params.requestId ? eq(adminAuditLog.requestId, params.requestId) : undefined,
    params.from ? gte(adminAuditLog.createdAt, params.from) : undefined,
    params.to ? lte(adminAuditLog.createdAt, params.to) : undefined,
    params.q
      ? or(
          ilike(adminAuditLog.actorAdminEmail, `%${params.q}%`),
          ilike(adminAuditLog.action, `%${params.q}%`),
          ilike(adminAuditLog.targetType, `%${params.q}%`),
          ilike(adminAuditLog.targetId, `%${params.q}%`)
        )
      : undefined,
  ];
  const where = and(...clauses);
  const [rows, [{ value: total }]] = await Promise.all([
    tx
      .select()
      .from(adminAuditLog)
      .where(where)
      .orderBy(desc(adminAuditLog.createdAt), desc(adminAuditLog.id))
      .limit(params.limit)
      .offset(params.offset),
    tx.select({ value: count() }).from(adminAuditLog).where(where),
  ]);
  return { rows, total: Number(total) };
}

export async function findById(id: string, tx: Executor = db): Promise<AdminAuditLog | null> {
  const [row] = await tx.select().from(adminAuditLog).where(eq(adminAuditLog.id, id)).limit(1);
  return row ?? null;
}

/** Who/where a mutation came from — threaded from the request into the audit row. */
export type AuditActor = {
  actorAdminEmail: string;
  requestId: string | null;
  ip: string | null;
};

/** Append-only — the only write this table ever takes. */
export async function append(
  input: NewAdminAuditLogRow,
  tx: Executor = db
): Promise<AdminAuditLog> {
  const [row] = await tx
    .insert(adminAuditLog)
    .values({
      ...input,
      before: sanitizeAuditMetadata(input.before),
      after: sanitizeAuditMetadata(input.after),
    })
    .returning();
  return row;
}

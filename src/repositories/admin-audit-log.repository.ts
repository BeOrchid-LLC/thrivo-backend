import { count, desc } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { adminAuditLog, type AdminAuditLogRow, type NewAdminAuditLogRow } from "../../db/schema";

export type AdminAuditLog = AdminAuditLogRow;

/** Admin viewer — offset-paginated, newest-first. Read-only surface over the
 *  append-only log; never filtered by actor here (small internal team). */
export async function listPaged(
  params: { offset: number; limit: number },
  tx: Executor = db
): Promise<{ rows: AdminAuditLog[]; total: number }> {
  const [rows, [{ value: total }]] = await Promise.all([
    tx
      .select()
      .from(adminAuditLog)
      .orderBy(desc(adminAuditLog.createdAt), desc(adminAuditLog.id))
      .limit(params.limit)
      .offset(params.offset),
    tx.select({ value: count() }).from(adminAuditLog),
  ]);
  return { rows, total: Number(total) };
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
  const [row] = await tx.insert(adminAuditLog).values(input).returning();
  return row;
}

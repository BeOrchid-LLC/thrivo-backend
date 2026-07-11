import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { adminAuditLog, type AdminAuditLogRow, type NewAdminAuditLogRow } from "../../db/schema";

export type AdminAuditLog = AdminAuditLogRow;

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

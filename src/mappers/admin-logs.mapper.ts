import type { AdminAuditLogEntry, AdminEmailLog } from "../../contracts/src/admin-logs";
import type { AdminAuditLogRow, EmailLogRow } from "../../db/schema";

export function toAdminEmailLog(row: EmailLogRow): AdminEmailLog {
  return {
    id: row.id,
    to: row.toEmail,
    template: row.template,
    kind: row.kind,
    status: row.status,
    attempts: row.attemptCount,
    providerMessageId: row.providerMessageId,
    sentAt: row.sentAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    failedAt: row.failedAt?.toISOString() ?? null,
    failureCode: row.failureCode,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toAdminAuditLogEntry(row: AdminAuditLogRow): AdminAuditLogEntry {
  return {
    id: row.id,
    actorEmail: row.actorAdminEmail,
    action: row.action,
    // Contract types targetType as a non-null string; the column is nullable
    // for actions with no single target (none today, but the schema allows it).
    targetType: row.targetType ?? "",
    targetId: row.targetId,
    requestId: row.requestId,
    createdAt: row.createdAt.toISOString(),
  };
}

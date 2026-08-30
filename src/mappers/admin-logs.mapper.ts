import type {
  AdminAuditLogDetail,
  AdminAuditLogEntry,
  AdminEmailLog,
  AdminEmailLogDetail,
} from "../../contracts/src/admin-logs";
import type { AdminAuditLogRow, EmailLogRow } from "../../db/schema";
import { sanitizeAuditMetadata } from "../lib/audit-metadata";

export function toAdminEmailLog(row: EmailLogRow): AdminEmailLog {
  return {
    id: row.id,
    userId: row.userId,
    leadId: row.leadId,
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

export function toAdminEmailLogDetail(
  row: EmailLogRow,
  resendCount = 0,
  resendHistory: EmailLogRow[] = []
): AdminEmailLogDetail {
  return {
    ...toAdminEmailLog(row),
    userId: row.userId,
    leadId: row.leadId,
    parentEmailLogId: row.parentEmailLogId,
    resendable: row.resendable,
    resendCount,
    resendHistory: resendHistory.map(toAdminEmailLog),
    lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
    providerEventAt: row.providerEventAt?.toISOString() ?? null,
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

export function toAdminAuditLogDetail(row: AdminAuditLogRow): AdminAuditLogDetail {
  return {
    ...toAdminAuditLogEntry(row),
    before: sanitizeAuditMetadata(row.before),
    after: sanitizeAuditMetadata(row.after),
    ip: row.ip,
  };
}

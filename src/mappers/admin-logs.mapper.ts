import type { AdminAuditLogEntry, AdminEmailLog } from "../../contracts/src/admin-logs";
import type { AdminAuditLogRow, EmailLogRow } from "../../db/schema";

/**
 * The admin email-log contract enum is `queued | sent | failed | bounced` and
 * has no `delivered` (the DB `email_status` enum's stronger success state). For
 * the viewer, a delivered mail collapses to `sent` — same success semantics,
 * one less badge variant to render. Widen the contract if delivery-vs-sent ever
 * needs to be distinguished in the UI.
 */
function toAdminEmailStatus(status: EmailLogRow["status"]): AdminEmailLog["status"] {
  return status === "delivered" ? "sent" : status;
}

export function toAdminEmailLog(row: EmailLogRow): AdminEmailLog {
  return {
    id: row.id,
    to: row.toEmail,
    template: row.template,
    status: toAdminEmailStatus(row.status),
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

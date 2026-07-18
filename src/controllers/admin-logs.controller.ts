import type { Context } from "hono";
import { z } from "zod";
import { respondOk } from "../lib/response";
import { buildOffsetMeta, parseOffset } from "../lib/pagination";
import { emailLogRepo, adminAuditLogRepo } from "../repositories";
import { toAdminAuditLogEntry, toAdminEmailLog } from "../mappers/admin-logs.mapper";
import type { AppEnv } from "../types/http";

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

const emailLogQuerySchema = listQuerySchema.extend({
  status: z.enum(["queued", "sent", "delivered", "bounced", "failed"]).optional(),
});

/** GET /admin/email-logs — offset-paginated transactional-email delivery log. */
export async function listAdminEmailLogs(c: Context<AppEnv>) {
  const { page, pageSize, status } = emailLogQuerySchema.parse(c.req.query());
  const params = parseOffset(page, pageSize);
  const { rows, total } = await emailLogRepo.listPaged({
    offset: params.offset,
    limit: params.pageSize,
    status,
  });
  return respondOk(c, {
    items: rows.map(toAdminEmailLog),
    pagination: buildOffsetMeta(params.page, params.pageSize, total),
  });
}

/** GET /admin/audit-log — offset-paginated view of the append-only admin audit trail. */
export async function listAdminAuditLog(c: Context<AppEnv>) {
  const { page, pageSize } = listQuerySchema.parse(c.req.query());
  const params = parseOffset(page, pageSize);
  const { rows, total } = await adminAuditLogRepo.listPaged({
    offset: params.offset,
    limit: params.pageSize,
  });
  return respondOk(c, {
    items: rows.map(toAdminAuditLogEntry),
    pagination: buildOffsetMeta(params.page, params.pageSize, total),
  });
}

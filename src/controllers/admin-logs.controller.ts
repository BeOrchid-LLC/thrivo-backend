import type { Context } from "hono";
import { z } from "zod";
import { respondOk } from "../lib/response";
import { buildOffsetMeta, parseOffset } from "../lib/pagination";
import { emailLogRepo, adminAuditLogRepo } from "../repositories";
import { toAdminAuditLogEntry, toAdminEmailLog } from "../mappers/admin-logs.mapper";
import type { AppEnv } from "../types/http";

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

const isoDate = z
  .string()
  .datetime({ offset: true })
  .transform((v) => new Date(v));

const emailLogQuerySchema = paginationSchema.extend({
  status: z
    .enum([
      "queued",
      "processing",
      "retrying",
      "sent",
      "delivered",
      "bounced",
      "complained",
      "suppressed",
      "failed",
      "expired",
    ])
    .optional(),
  kind: z
    .enum([
      "welcome",
      "weekly_review",
      "trial_ending",
      "cancellation_confirmation",
      "admin_otp",
      "admin_invite",
      "admin_password_reset",
      "legacy_notification",
    ])
    .optional(),
  template: z.string().optional(),
  to: z.string().optional(),
  from: isoDate.optional(),
  toDate: isoDate.optional(),
});

const auditLogQuerySchema = paginationSchema.extend({
  actorEmail: z.string().email().optional(),
  action: z.string().optional(),
  targetType: z.string().optional(),
  targetId: z.string().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

/** GET /admin/email-logs — offset-paginated transactional-email delivery log. */
export async function listAdminEmailLogs(c: Context<AppEnv>) {
  const { page, pageSize, status, kind, template, to, from, toDate } = emailLogQuerySchema.parse(
    c.req.query()
  );
  const params = parseOffset(page, pageSize);
  const { rows, total } = await emailLogRepo.listPaged({
    offset: params.offset,
    limit: params.pageSize,
    status,
    kind,
    template,
    toEmail: to,
    from,
    to: toDate,
  });
  return respondOk(c, {
    items: rows.map(toAdminEmailLog),
    pagination: buildOffsetMeta(params.page, params.pageSize, total),
  });
}

/** GET /admin/audit-log — offset-paginated view of the append-only admin audit trail. */
export async function listAdminAuditLog(c: Context<AppEnv>) {
  const { page, pageSize, actorEmail, action, targetType, targetId, from, to } =
    auditLogQuerySchema.parse(c.req.query());
  const params = parseOffset(page, pageSize);
  const { rows, total } = await adminAuditLogRepo.listPaged({
    offset: params.offset,
    limit: params.pageSize,
    actorEmail,
    action,
    targetType,
    targetId,
    from,
    to,
  });
  return respondOk(c, {
    items: rows.map(toAdminAuditLogEntry),
    pagination: buildOffsetMeta(params.page, params.pageSize, total),
  });
}

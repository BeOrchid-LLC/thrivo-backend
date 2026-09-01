import type { Context } from "hono";
import { z } from "zod";
import { respondOk } from "../lib/response";
import { buildOffsetMeta, parseOffset } from "../lib/pagination";
import {
  adminAuditLogRepo,
  emailLogRepo,
  emailReplayPayloadRepo,
  emailSuppressionRepo,
  adminActionIdempotencyRepo,
} from "../repositories";
import {
  toAdminAuditLogDetail,
  toAdminAuditLogEntry,
  toAdminEmailLog,
  toAdminEmailLogDetail,
} from "../mappers/admin-logs.mapper";
import type { AppEnv } from "../types/http";
import { ConflictError, NotFoundError } from "../lib/errors";
import { getValidatedInput } from "../middleware/validate";
import { adminEmailResendPayloadSchema } from "../../contracts/src/admin-logs";
import { decryptEmailPayload } from "../lib/email/outbox-crypto";
import { queueEmailResend } from "../services/email.service";
import { getClientIp } from "../lib/request-ip";
import { env } from "../env";

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
      "waitlist_confirmation",
      "lead_contact",
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
  requestId: z.string().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  q: z.string().optional(),
});

const profileActivityQuerySchema = paginationSchema;

function csvField(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

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

export async function getAdminEmailLog(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const row = await emailLogRepo.findById(id);
  if (!row) throw new NotFoundError("Email log not found");
  return respondOk(c, {
    emailLog: toAdminEmailLogDetail(
      row,
      await emailLogRepo.countResends(id),
      await emailLogRepo.listResends(id)
    ),
  });
}

export async function resendAdminEmail(c: Context<AppEnv>) {
  if (!env.ADMIN_EMAIL_RESEND_ENABLED) throw new ConflictError("Email resend is disabled");
  const id = c.req.param("id") ?? "";
  adminEmailResendPayloadSchema.parse(getValidatedInput(c, "json"));
  const idempotencyKey = c.req.header("Idempotency-Key")?.trim();
  if (!idempotencyKey) throw new ConflictError("Idempotency-Key is required");

  const source = await emailLogRepo.findById(id);
  if (!source) throw new NotFoundError("Email log not found");
  if (!source.resendable || !["failed", "expired"].includes(source.status)) {
    throw new ConflictError("This email is not eligible for resend");
  }
  if (
    source.kind === "admin_otp" ||
    source.kind === "admin_invite" ||
    source.kind === "admin_password_reset"
  ) {
    throw new ConflictError("Authentication emails cannot be resent from the email log");
  }
  const suppression = await emailSuppressionRepo.findActive(source.toEmail);
  if (suppression) throw new ConflictError("Recipient is currently suppressed");
  const replay = await emailReplayPayloadRepo.findByEmailLogId(id);
  if (!replay) throw new ConflictError("The resend payload has expired");

  const reservation = await adminActionIdempotencyRepo.reserve("email.resend", id, idempotencyKey);
  if (!reservation.created) {
    if (!reservation.row.response)
      throw new ConflictError("This resend request is still in progress");
    return respondOk(
      c,
      reservation.row.response,
      reservation.row.responseMessage,
      reservation.row.responseStatus as 202
    );
  }

  try {
    const payload = decryptEmailPayload<{ template: string; props: unknown }>(
      {
        keyId: replay.encryptionKeyId,
        iv: replay.payloadIv,
        authTag: replay.payloadAuthTag,
        ciphertext: replay.payloadCiphertext,
      },
      source.id,
      source.kind
    );
    const newId = await queueEmailResend({
      sourceId: source.id,
      kind: source.kind,
      to: source.toEmail,
      template: payload.template as never,
      props: payload.props,
      userId: source.userId,
      leadId: source.leadId,
      idempotencyKey,
    });
    const queued = await emailLogRepo.findById(newId);
    if (!queued || queued.status === "suppressed") {
      throw new ConflictError("Recipient is currently suppressed");
    }
    const result = { emailLog: toAdminEmailLogDetail(queued, 0) };
    await adminAuditLogRepo.append({
      actorAdminEmail: c.get("adminUser")!.email,
      action: "email.resend",
      targetType: "email_log",
      targetId: source.id,
      before: { sourceStatus: source.status },
      after: { sourceEmailLogId: source.id, newEmailLogId: newId, outcome: "queued" },
      requestId: c.get("requestId") ?? null,
      ip: getClientIp(c),
    });
    await adminActionIdempotencyRepo.complete(
      reservation.row.id,
      result,
      "Email resend queued",
      202
    );
    return respondOk(c, result, "Email resend queued", 202);
  } catch (error) {
    await adminActionIdempotencyRepo.release(reservation.row.id);
    throw error;
  }
}

/** GET /admin/audit-log — offset-paginated view of the append-only admin audit trail. */
export async function listAdminAuditLog(c: Context<AppEnv>) {
  const { page, pageSize, actorEmail, action, targetType, targetId, requestId, from, to, q } =
    auditLogQuerySchema.parse(c.req.query());
  const params = parseOffset(page, pageSize);
  const { rows, total } = await adminAuditLogRepo.listPaged({
    offset: params.offset,
    limit: params.pageSize,
    actorEmail,
    action,
    targetType,
    targetId,
    requestId,
    from,
    to,
    q,
  });
  return respondOk(c, {
    items: rows.map(toAdminAuditLogEntry),
    pagination: buildOffsetMeta(params.page, params.pageSize, total),
  });
}

/** GET /admin/auth/profile/activity — activity scoped to the authenticated admin. */
export async function listAdminProfileActivity(c: Context<AppEnv>) {
  const { page, pageSize } = profileActivityQuerySchema.parse(c.req.query());
  const params = parseOffset(page, pageSize);
  const admin = c.get("adminUser")!;
  const { rows, total } = await adminAuditLogRepo.listPaged({
    offset: params.offset,
    limit: params.pageSize,
    actorEmail: admin.email.toLowerCase(),
  });
  return respondOk(c, {
    items: rows.map(toAdminAuditLogEntry),
    pagination: buildOffsetMeta(params.page, params.pageSize, total),
  });
}

export async function getAdminAuditLog(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const row = await adminAuditLogRepo.findById(id);
  if (!row) throw new NotFoundError("Audit entry not found");
  return respondOk(c, { entry: toAdminAuditLogDetail(row) });
}

/** GET /admin/audit-log/export — filtered CSV without before/after payloads. */
export async function exportAdminAuditLog(c: Context<AppEnv>) {
  const { actorEmail, action, targetType, targetId, requestId, from, to, q } =
    auditLogQuerySchema.parse(c.req.query());
  const { rows } = await adminAuditLogRepo.listPaged({
    offset: 0,
    limit: 10_001,
    actorEmail,
    action,
    targetType,
    targetId,
    requestId,
    from,
    to,
    q,
  });
  const truncated = rows.length > 10_000;
  const header = [
    "id",
    "actor_email",
    "action",
    "target_type",
    "target_id",
    "request_id",
    "created_at",
  ].join(",");
  const csv = [
    header,
    ...rows
      .slice(0, 10_000)
      .map((row) =>
        [
          row.id,
          row.actorAdminEmail,
          row.action,
          row.targetType,
          row.targetId,
          row.requestId,
          row.createdAt.toISOString(),
        ]
          .map(csvField)
          .join(",")
      ),
  ].join("\n");
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", 'attachment; filename="audit-log.csv"');
  c.header("X-Export-Row-Limit", "10000");
  c.header("X-Export-Truncated", String(truncated));
  return c.body(csv);
}

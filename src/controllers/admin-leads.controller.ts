import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../db";
import { respondOk } from "../lib/response";
import { getClientIp } from "../lib/request-ip";
import {
  adminAuditLogRepo,
  adminActionIdempotencyRepo,
  emailCaptureRepo,
  emailLogRepo,
  emailSuppressionRepo,
  leadNotesRepo,
  userRepo,
} from "../repositories";
import type { EmailCapture } from "../repositories/email-capture.repository";
import type { AppEnv } from "../types/http";
import { getValidatedInput } from "../middleware/validate";
import {
  adminLeadContactPayloadSchema,
  adminLeadLinkUserPayloadSchema,
  adminLeadNotePayloadSchema,
  adminLeadUpdatePayloadSchema,
} from "../../contracts/src/leads";
import { ConflictError, NotFoundError } from "../lib/errors";
import { queueTemplatedEmail } from "../services/email.service";
import { toAdminLead } from "../repositories/email-capture.repository";
import { env } from "../env";
import { queryBooleanSchema } from "../lib/query-params";
import { toAdminEmailLog } from "../mappers/admin-logs.mapper";

async function toAdminLeadDetail(id: string) {
  const row = await emailCaptureRepo.findById(id);
  if (!row) return null;
  const [notes, linkedUser, recentEmails] = await Promise.all([
    leadNotesRepo.listForLead(id),
    row.reconciledUserId ? userRepo.findById(row.reconciledUserId) : Promise.resolve(null),
    emailLogRepo.listForLead(id),
  ]);
  return {
    ...toAdminLead(row),
    notes: notes.map((note) => ({
      id: note.id,
      leadId: note.leadId,
      authorAdminEmail: note.authorAdminEmail,
      body: note.body,
      createdAt: note.createdAt.toISOString(),
    })),
    linkedUser: linkedUser
      ? {
          id: linkedUser.id,
          email: linkedUser.email,
          name: linkedUser.name,
          tier: linkedUser.tier,
        }
      : null,
    recentEmails: recentEmails.map(toAdminEmailLog),
  };
}

const listParamsSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().optional(),
  status: z.enum(["new", "contacted", "qualified", "converted", "unsubscribed", "spam"]).optional(),
  owner: z.string().email().optional(),
  source: z.string().optional(),
  reconciled: queryBooleanSchema.optional(),
  from: z
    .string()
    .datetime({ offset: true })
    .transform((v) => new Date(v))
    .optional(),
  to: z
    .string()
    .datetime({ offset: true })
    .transform((v) => new Date(v))
    .optional(),
});

/** GET /admin/leads — keyset-paginated lead list with optional email search (R5-4). */
export async function listAdminLeads(c: Context<AppEnv>) {
  const query = c.req.query();
  const params = listParamsSchema.parse(query);
  const result = await emailCaptureRepo.list({
    ...params,
    ownerAdminEmail: params.owner,
  });
  return respondOk(c, result);
}

export async function getAdminLead(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const row = await emailCaptureRepo.findById(id);
  if (!row) throw new NotFoundError("Lead not found");
  return respondOk(c, { lead: await toAdminLeadDetail(id) });
}

function auditActor(c: Context<AppEnv>) {
  const admin = c.get("adminUser")!;
  return {
    actorAdminEmail: admin.email,
    requestId: c.get("requestId") ?? null,
    ip: getClientIp(c),
  };
}

export async function updateAdminLead(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const input = adminLeadUpdatePayloadSchema.parse(getValidatedInput(c, "json"));
  const row = await emailCaptureRepo.updateAdminFields(id, input, auditActor(c));
  if (!row) throw new NotFoundError("Lead not found");
  return respondOk(c, { lead: await toAdminLeadDetail(id) }, "Lead updated");
}

export async function addAdminLeadNote(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const input = adminLeadNotePayloadSchema.parse(getValidatedInput(c, "json"));
  const note = await db.transaction(async (tx) => {
    const lead = await emailCaptureRepo.findById(id, tx);
    if (!lead) throw new NotFoundError("Lead not found");
    const created = await leadNotesRepo.create(
      {
        leadId: id,
        authorAdminEmail: c.get("adminUser")!.email,
        body: input.body,
      },
      tx
    );
    await adminAuditLogRepo.append(
      {
        ...auditActor(c),
        action: "lead.note_add",
        targetType: "lead",
        targetId: id,
        after: { noteId: created.id },
      },
      tx
    );
    return created;
  });
  return respondOk(
    c,
    {
      lead: await toAdminLeadDetail(id),
      note: {
        id: note.id,
        leadId: note.leadId,
        authorAdminEmail: note.authorAdminEmail,
        body: note.body,
        createdAt: note.createdAt.toISOString(),
      },
    },
    "Note added",
    201
  );
}

export async function linkAdminLeadUser(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const { userId } = adminLeadLinkUserPayloadSchema.parse(getValidatedInput(c, "json"));
  const result = await emailCaptureRepo.linkToUser(id, userId, auditActor(c));
  if (result === "not_found") throw new NotFoundError("Lead not found");
  if (result === "email_mismatch") throw new ConflictError("Lead and user emails do not match");
  return respondOk(c, { lead: await toAdminLeadDetail(id) }, "Lead linked");
}

export async function contactAdminLead(c: Context<AppEnv>) {
  if (!env.ADMIN_LEAD_CONTACT_ENABLED) throw new ConflictError("Lead contact is disabled");
  const id = c.req.param("id") ?? "";
  const input = adminLeadContactPayloadSchema.parse(getValidatedInput(c, "json"));
  const idempotencyKey = c.req.header("Idempotency-Key")?.trim();
  if (!idempotencyKey) throw new ConflictError("Idempotency-Key is required");
  const lead = await emailCaptureRepo.findById(id);
  if (!lead) throw new NotFoundError("Lead not found");
  if (lead.status === "spam" || lead.status === "unsubscribed")
    throw new ConflictError("This lead cannot be contacted");
  if (await emailSuppressionRepo.findActive(lead.email))
    throw new ConflictError("Recipient is currently suppressed");

  const reservation = await adminActionIdempotencyRepo.reserve("lead.contact", id, idempotencyKey);
  if (!reservation.created) {
    if (!reservation.row.response)
      throw new ConflictError("This contact request is still in progress");
    return respondOk(
      c,
      reservation.row.response,
      reservation.row.responseMessage,
      reservation.row.responseStatus as 202
    );
  }

  try {
    const emailLogId = await queueTemplatedEmail({
      kind: "lead_contact",
      to: lead.email,
      leadId: lead.id,
      template: "notification",
      resendable: true,
      dedupeKey: `lead-contact:${lead.id}:${idempotencyKey}`,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      props: {
        title: "A Thrivo update",
        body: "We’re getting closer to launch. We’ll keep you posted with the next update.",
      },
    });
    const queuedLog = await emailLogRepo.findById(emailLogId);
    if (!queuedLog || queuedLog.status === "suppressed") {
      throw new ConflictError("Recipient is currently suppressed");
    }
    await emailCaptureRepo.updateAdminFields(id, { status: "contacted" }, auditActor(c));
    const result = { lead: await toAdminLeadDetail(id), emailLogId };
    await adminAuditLogRepo.append({
      ...auditActor(c),
      action: "lead.contact",
      targetType: "lead",
      targetId: id,
      before: { status: lead.status },
      after: { emailLogId, template: input.template, outcome: "queued", status: "contacted" },
    });
    await adminActionIdempotencyRepo.complete(
      reservation.row.id,
      result,
      "Lead contact queued",
      202
    );
    return respondOk(c, result, "Lead contact queued", 202);
  } catch (error) {
    await adminActionIdempotencyRepo.release(reservation.row.id);
    throw error;
  }
}

/** DELETE /admin/leads/:id — hard delete (spam/bad-email cleanup). Idempotent. */
export async function hardDeleteAdminLead(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const admin = c.get("adminUser")!;
  await emailCaptureRepo.hardDelete(id, {
    actorAdminEmail: admin.email,
    requestId: c.get("requestId") ?? null,
    ip: getClientIp(c),
  });
  return respondOk(c, null, "Lead deleted permanently");
}

const CSV_COLUMNS: { key: keyof EmailCapture; header: string }[] = [
  { key: "id", header: "id" },
  { key: "email", header: "email" },
  { key: "source", header: "source" },
  { key: "submissionCount", header: "submission_count" },
  { key: "capturedAt", header: "captured_at" },
  { key: "lastSubmittedAt", header: "last_submitted_at" },
  { key: "country", header: "country" },
  { key: "deviceType", header: "device_type" },
  { key: "osName", header: "os_name" },
  { key: "osVersion", header: "os_version" },
  { key: "browserName", header: "browser_name" },
  { key: "browserVersion", header: "browser_version" },
  { key: "referrer", header: "referrer" },
  { key: "utmSource", header: "utm_source" },
  { key: "utmMedium", header: "utm_medium" },
  { key: "utmCampaign", header: "utm_campaign" },
  { key: "status", header: "status" },
  { key: "ownerAdminEmail", header: "owner_admin_email" },
  { key: "tags", header: "tags" },
  { key: "updatedAt", header: "updated_at" },
];

/** Quote a CSV field only when it needs it (contains a comma, quote, or newline). */
function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return csvField(value.join(";"));
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows: EmailCapture[]): string {
  const header = CSV_COLUMNS.map((col) => col.header).join(",");
  const lines = rows.map((row) => CSV_COLUMNS.map((col) => csvField(row[col.key])).join(","));
  return [header, ...lines].join("\n");
}

/**
 * GET /admin/leads/export — streams a CSV directly (no R2/signed-URL
 * indirection; small table, no need for object storage). Same requireAdmin
 * httpOnly cookie as every other admin route gates this.
 */
export async function exportAdminLeads(c: Context<AppEnv>) {
  const params = listParamsSchema.parse(c.req.query());
  const rows = await emailCaptureRepo.listAll({
    search: params.search,
    status: params.status,
    ownerAdminEmail: params.owner,
    source: params.source,
    reconciled: params.reconciled,
    from: params.from,
    to: params.to,
  });
  const truncated = rows.length > 10_000;
  const csv = toCsv(truncated ? rows.slice(0, 10_000) : rows);
  c.header("X-Export-Row-Limit", "10000");
  c.header("X-Export-Truncated", String(truncated));
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", 'attachment; filename="leads.csv"');
  return c.body(csv);
}

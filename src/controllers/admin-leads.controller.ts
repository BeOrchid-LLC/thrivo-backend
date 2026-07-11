import type { Context } from "hono";
import { z } from "zod";
import { respondOk } from "../lib/response";
import { getClientIp } from "../lib/request-ip";
import { emailCaptureRepo } from "../repositories";
import type { EmailCapture } from "../repositories/email-capture.repository";
import type { AppEnv } from "../types/http";

const listParamsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
});

/** GET /admin/leads — paginated lead list with optional email search. */
export async function listAdminLeads(c: Context<AppEnv>) {
  const query = c.req.query();
  const params = listParamsSchema.parse(query);
  const result = await emailCaptureRepo.list(params);
  return respondOk(c, result);
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
];

/** Quote a CSV field only when it needs it (contains a comma, quote, or newline). */
function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
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
  const rows = await emailCaptureRepo.listAll();
  const csv = toCsv(rows);
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", 'attachment; filename="leads.csv"');
  return c.body(csv);
}

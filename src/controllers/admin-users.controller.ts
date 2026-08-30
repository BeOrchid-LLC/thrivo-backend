import type { Context } from "hono";
import { z } from "zod";
import { respondOk } from "../lib/response";
import { NotFoundError, ValidationError } from "../lib/errors";
import { accountErasureRepo, adminUserRepo, userRepo } from "../repositories";
import {
  adminActivityTypeSchema,
  adminDeleteUserPayloadSchema,
  adminRetryErasurePayloadSchema,
} from "../../contracts/src/admin";
import { requestAccountErasure } from "../services/account-erasure.service";
import { retryAccountErasure } from "../services/account-erasure.service";
import * as adminAuditLogRepo from "../repositories/admin-audit-log.repository";
import { getClientIp } from "../lib/request-ip";
import { getValidatedInput } from "../middleware/validate";
import { getUserTimeline } from "../services/admin-timeline.service";
import { getUserActivity } from "../services/admin-activity.service";
import type { AppEnv } from "../types/http";

function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const listParamsSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().optional(),
  status: z.string().optional(),
});

const erasureListParamsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["pending", "processing", "retryable", "failed", "completed"]).optional(),
  search: z.string().optional(),
});

/** GET /admin/users — keyset-paginated user list with optional search + status filter (R5-4). */
export async function listAdminUsers(c: Context<AppEnv>) {
  const query = c.req.query();
  const params = listParamsSchema.parse(query);
  const result = await adminUserRepo.listUsers(params);
  return respondOk(c, result);
}

/** GET /admin/users/export — bounded, authenticated CSV export. */
export async function exportAdminUsers(c: Context<AppEnv>) {
  const { search, status } = listParamsSchema.parse(c.req.query());
  const rows = await adminUserRepo.listAllForExport({ search, status });
  const truncated = rows.length > 10_000;
  const header = [
    "id",
    "email",
    "name",
    "tier",
    "account_status",
    "created_at",
    "last_active_at",
    "deleted_at",
  ];
  const csv = [
    header.join(","),
    ...rows
      .slice(0, 10_000)
      .map((row) =>
        [
          row.id,
          row.email,
          row.name,
          row.tier,
          row.accountStatus,
          row.createdAt,
          row.lastActiveAt,
          row.deletedAt,
        ]
          .map(csvField)
          .join(",")
      ),
  ].join("\n");
  c.header("X-Export-Row-Limit", "10000");
  c.header("X-Export-Truncated", String(truncated));
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", 'attachment; filename="users.csv"');
  return c.body(csv);
}

/** GET /admin/users/:id — full user detail for the admin panel. */
export async function getAdminUser(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const user = await adminUserRepo.findById(id);
  if (!user) throw new NotFoundError("User not found");
  return respondOk(c, { user });
}

/** GET /admin/users/:id/timeline — merged subscription + product-event history. */
export async function getAdminUserTimeline(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const timeline = await getUserTimeline(id);
  return respondOk(c, { timeline });
}

const activityQuerySchema = z.object({
  type: adminActivityTypeSchema,
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

/** GET /admin/users/:id/activity?type=food_logs|check_ins|weight_logs&limit= */
export async function getAdminUserActivity(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const parsed = activityQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    throw new ValidationError("Validation failed", parsed.error.flatten());
  }
  const { type, limit } = parsed.data;
  const page = await getUserActivity(id, type, limit);
  return respondOk(c, page);
}

/**
 * DELETE /admin/users/:id — enqueue the same durable erasure workflow used by users.
 */
export async function hardDeleteAdminUser(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const payload = adminDeleteUserPayloadSchema.parse({
    confirmationEmail: c.req.query("confirmationEmail"),
  });
  const user = await userRepo.findById(id);
  if (!user) return respondOk(c, null, "Erasure already queued", 202);
  if (payload.confirmationEmail.toLowerCase() !== user.email.toLowerCase()) {
    throw new ValidationError("Confirmation email does not match the current user");
  }
  await requestAccountErasure(user.id, user.authSubjectId ?? user.id, user.email);
  await adminAuditLogRepo.append({
    actorAdminEmail: c.get("adminUser")!.email,
    action: "account_erasure.queued",
    targetType: "user",
    targetId: id,
    requestId: c.get("requestId") ?? null,
    ip: getClientIp(c),
  });
  return respondOk(c, null, "Account erasure queued", 202);
}

export async function listAdminAccountErasures(c: Context<AppEnv>) {
  const params = erasureListParamsSchema.parse(c.req.query());
  const { rows, total } = await accountErasureRepo.listPaged(params);
  return respondOk(c, {
    erasures: rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      userEmail: row.userEmail ?? null,
      status: row.status,
      requestedAt: row.requestedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      lastErrorCode: row.lastErrorCode,
      attempts: row.attempts,
      consecutiveFailures: row.consecutiveFailures,
      nextAttemptAt: row.nextAttemptAt.toISOString(),
      processingStartedAt: row.processingStartedAt?.toISOString() ?? null,
      leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
      phase: row.phase,
      canRetry: row.status === "failed" || row.status === "retryable",
    })),
    pagination: {
      page: params.page,
      pageSize: params.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
    },
  });
}

export async function retryAdminAccountErasure(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  adminRetryErasurePayloadSchema.parse(getValidatedInput(c, "json"));
  const request = await accountErasureRepo.findById(id);
  if (!request) throw new NotFoundError("Erasure request not found");
  if (request.status !== "failed" && request.status !== "retryable") {
    throw new ValidationError("Only failed or retryable erasures can be retried");
  }
  await retryAccountErasure(id);
  await adminAuditLogRepo.append({
    actorAdminEmail: c.get("adminUser")!.email,
    action: "account_erasure.retry",
    targetType: "account_erasure",
    targetId: id,
    requestId: c.get("requestId") ?? null,
    ip: getClientIp(c),
  });
  return respondOk(c, null, "Erasure retry queued");
}

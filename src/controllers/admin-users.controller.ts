import type { Context } from "hono";
import { z } from "zod";
import { respondOk } from "../lib/response";
import { NotFoundError, ValidationError } from "../lib/errors";
import { getClientIp } from "../lib/request-ip";
import { adminUserRepo } from "../repositories";
import { adminActivityTypeSchema } from "../../contracts/src/admin";
import { getUserTimeline } from "../services/admin-timeline.service";
import { getUserActivity } from "../services/admin-activity.service";
import type { AppEnv } from "../types/http";

const listParamsSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().optional(),
  status: z.string().optional(),
});

/** GET /admin/users — keyset-paginated user list with optional search + status filter (R5-4). */
export async function listAdminUsers(c: Context<AppEnv>) {
  const query = c.req.query();
  const params = listParamsSchema.parse(query);
  const result = await adminUserRepo.listUsers(params);
  return respondOk(c, result);
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
 * DELETE /admin/users/:id — permanent hard delete for test teardown.
 * Cascades FK-linked rows (food_logs, sessions, etc.) via the DB constraint.
 * Returns 200 with a null ack envelope whether or not the user existed (idempotent).
 */
export async function hardDeleteAdminUser(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const admin = c.get("adminUser")!;
  await adminUserRepo.hardDeleteUser(id, {
    actorAdminEmail: admin.email,
    requestId: c.get("requestId") ?? null,
    ip: getClientIp(c),
  });
  return respondOk(c, null, "User deleted permanently");
}

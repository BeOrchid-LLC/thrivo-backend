import type { Context } from "hono";
import { z } from "zod";
import { respondOk } from "../lib/response";
import { NotFoundError } from "../lib/errors";
import { getClientIp } from "../lib/request-ip";
import { adminUserRepo } from "../repositories";
import type { AppEnv } from "../types/http";

const listParamsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  status: z.string().optional(),
});

/** GET /admin/users — paginated user list with optional search + status filter. */
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

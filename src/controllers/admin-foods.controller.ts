import type { Context } from "hono";
import { z } from "zod";
import {
  adminFoodEditPayloadSchema,
  adminFoodMergePayloadSchema,
  adminFoodRejectPayloadSchema,
} from "../../contracts/src/admin-foods";
import { ConflictError, NotFoundError, ValidationError } from "../lib/errors";
import { respondOk } from "../lib/response";
import { getClientIp } from "../lib/request-ip";
import { getValidatedInput } from "../middleware/validate";
import { adminFoodRepo } from "../repositories";
import type { AuditActor } from "../repositories/admin-audit-log.repository";
import type { AppEnv } from "../types/http";

const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: z.enum(["active", "pending", "rejected", "merged"]).optional(),
  tier: z.enum(["authoritative", "community", "personal"]).optional(),
  origin: z.enum(["usda", "openfoodfacts", "community", "personal"]).optional(),
  search: z.string().optional(),
});

function auditActor(c: Context<AppEnv>): AuditActor {
  const admin = c.get("adminUser")!;
  return {
    actorAdminEmail: admin.email,
    requestId: c.get("requestId") ?? null,
    ip: getClientIp(c),
  };
}

/** GET /admin/foods — keyset-paginated moderation queue (personal items excluded). */
export async function listAdminFoods(c: Context<AppEnv>) {
  const q = listQuerySchema.parse(c.req.query());
  // `personal` is never listable here — reject rather than silently ignore, so
  // a caller doesn't think they're seeing personal items.
  if (q.tier === "personal") throw new ValidationError("Personal items are not moderated");
  const result = await adminFoodRepo.listPaged(q);
  return respondOk(c, {
    items: result.items,
    pagination: { limit: result.limit, total: result.total, nextCursor: result.nextCursor },
  });
}

/** GET /admin/foods/:id — full item detail with nutrients + servings. */
export async function getAdminFood(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const food = await adminFoodRepo.findDetail(id);
  if (!food) throw new NotFoundError("Food item not found");
  return respondOk(c, { food });
}

async function requireDetail(id: string) {
  const food = await adminFoodRepo.findDetail(id);
  if (!food) throw new NotFoundError("Food item not found");
  return food;
}

/** POST /admin/foods/:id/approve — mark active (support+). */
export async function approveAdminFood(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const ok = await adminFoodRepo.moderate(id, "approve", auditActor(c));
  if (!ok) throw new NotFoundError("Food item not found");
  return respondOk(c, { food: await requireDetail(id) }, "Food approved");
}

/** POST /admin/foods/:id/reject — mark rejected with a reason (support+). */
export async function rejectAdminFood(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const { reason } = adminFoodRejectPayloadSchema.parse(getValidatedInput(c, "json"));
  const ok = await adminFoodRepo.moderate(id, "reject", auditActor(c), reason);
  if (!ok) throw new NotFoundError("Food item not found");
  return respondOk(c, { food: await requireDetail(id) }, "Food rejected");
}

/** POST /admin/foods/:id/verify — set/clear the verified badge (support+). */
export async function verifyAdminFood(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const action = c.req.query("unverify") === "1" ? "unverify" : "verify";
  const ok = await adminFoodRepo.moderate(id, action, auditActor(c));
  if (!ok) throw new NotFoundError("Food item not found");
  return respondOk(
    c,
    { food: await requireDetail(id) },
    action === "verify" ? "Verified" : "Unverified"
  );
}

/** PATCH /admin/foods/:id — edit name/brand/macros (support+). */
export async function editAdminFood(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const input = adminFoodEditPayloadSchema.parse(getValidatedInput(c, "json"));
  const ok = await adminFoodRepo.applyEdit(id, input, auditActor(c));
  if (!ok) throw new NotFoundError("Food item not found");
  return respondOk(c, { food: await requireDetail(id) }, "Food updated");
}

/** POST /admin/foods/:id/merge — merge into a canonical item (admin only). */
export async function mergeAdminFood(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const { mergeIntoId, reason } = adminFoodMergePayloadSchema.parse(getValidatedInput(c, "json"));
  const result = await adminFoodRepo.merge(id, mergeIntoId, auditActor(c), reason);
  if (result === "same_item") throw new ValidationError("Cannot merge an item into itself");
  if (result === "not_found") throw new NotFoundError("Food item not found");
  if (result === "invalid_target")
    throw new ConflictError("Merge target not found or not mergeable");
  return respondOk(c, { food: await requireDetail(id) }, "Food merged");
}

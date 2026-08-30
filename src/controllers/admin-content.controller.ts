import type { Context } from "hono";
import { z } from "zod";
import {
  adminDuplicateTipPayloadSchema,
  adminUpsertTipPayloadSchema,
} from "../../contracts/src/admin-content";
import { NotFoundError } from "../lib/errors";
import { respondOk } from "../lib/response";
import { getClientIp } from "../lib/request-ip";
import { buildOffsetMeta, parseOffset } from "../lib/pagination";
import { adminMoodToDb, toAdminTip } from "../mappers/admin-tip.mapper";
import { getValidatedInput } from "../middleware/validate";
import { tipRepo } from "../repositories";
import type { AuditActor } from "../repositories/admin-audit-log.repository";
import type { AppEnv } from "../types/http";
import { queryBooleanSchema } from "../lib/query-params";

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  mood: z.enum(["great", "good", "ok", "low", "bad"]).optional(),
  active: queryBooleanSchema.optional(),
  pinnedFrom: z.string().optional(),
  pinnedTo: z.string().optional(),
});

function auditActor(c: Context<AppEnv>): AuditActor {
  const admin = c.get("adminUser")!;
  return {
    actorAdminEmail: admin.email,
    requestId: c.get("requestId") ?? null,
    ip: getClientIp(c),
  };
}

/** GET /admin/tips — offset-paginated psychology-tip bank. */
export async function listAdminTips(c: Context<AppEnv>) {
  const { page, pageSize, mood, active, pinnedFrom, pinnedTo } = listQuerySchema.parse(
    c.req.query()
  );
  const params = parseOffset(page, pageSize);
  const { rows, total } = await tipRepo.listPaged({
    offset: params.offset,
    limit: params.pageSize,
    mood,
    active,
    pinnedFrom,
    pinnedTo,
  });
  return respondOk(c, {
    items: rows.map(toAdminTip),
    pagination: buildOffsetMeta(params.page, params.pageSize, total),
  });
}

/** POST /admin/tips — create a tip (audited). */
export async function createAdminTip(c: Context<AppEnv>) {
  const input = adminUpsertTipPayloadSchema.parse(getValidatedInput(c, "json"));
  const tip = await tipRepo.create(
    {
      body: input.body,
      mood: adminMoodToDb(input.mood),
      isActive: input.isActive ?? true,
      pinnedDate: input.pinnedDate ?? null,
    },
    auditActor(c)
  );
  return respondOk(c, { tip: toAdminTip(tip) }, "Tip created", 201);
}

/** PATCH /admin/tips/:id — update a tip (audited). Only provided fields change. */
export async function updateAdminTip(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const input = adminUpsertTipPayloadSchema.parse(getValidatedInput(c, "json"));
  const tip = await tipRepo.update(
    id,
    {
      body: input.body,
      // `mood`/`pinnedDate` are only touched when the client sends them, so
      // partial edits don't clobber an existing pin/mood with null.
      ...(input.mood !== undefined ? { mood: adminMoodToDb(input.mood) } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.pinnedDate !== undefined ? { pinnedDate: input.pinnedDate } : {}),
    },
    auditActor(c)
  );
  if (!tip) throw new NotFoundError("Tip not found");
  return respondOk(c, { tip: toAdminTip(tip) }, "Tip updated");
}

/** DELETE /admin/tips/:id — hard delete (audited). Idempotent on a missing id. */
export async function deleteAdminTip(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  await tipRepo.remove(id, auditActor(c));
  return respondOk(c, null, "Tip deleted");
}

export async function duplicateAdminTip(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  adminDuplicateTipPayloadSchema.parse(getValidatedInput(c, "json"));
  const tip = await tipRepo.duplicate(id, auditActor(c));
  if (!tip) throw new NotFoundError("Tip not found");
  return respondOk(c, { tip: toAdminTip(tip) }, "Tip duplicated", 201);
}

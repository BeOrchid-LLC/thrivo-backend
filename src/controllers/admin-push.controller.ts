import type { Context } from "hono";
import { z } from "zod";
import {
  adminAudienceEstimatePayloadSchema,
  adminCreateCampaignPayloadSchema,
  adminUpdateCampaignPayloadSchema,
  adminCampaignCancelPayloadSchema,
  adminCampaignTestPayloadSchema,
} from "../../contracts/src/admin-push";
import { NotFoundError } from "../lib/errors";
import { respondOk } from "../lib/response";
import { getClientIp } from "../lib/request-ip";
import { getValidatedInput } from "../middleware/validate";
import { adminActionIdempotencyRepo, pushCampaignRepo } from "../repositories";
import * as adminAuditLogRepo from "../repositories/admin-audit-log.repository";
import {
  cancelScheduledCampaign,
  createCampaign,
  queueCampaignTest,
  sendCampaign,
  updateDraftCampaign,
} from "../services/admin-push.service";
import type { AppEnv } from "../types/http";
import { ConflictError } from "../lib/errors";
import { env } from "../env";

const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

function audit(c: Context<AppEnv>) {
  return {
    actorAdminEmail: c.get("adminUser")!.email,
    requestId: c.get("requestId") ?? null,
    ip: getClientIp(c),
  };
}

/** GET /admin/push/campaigns — keyset list of campaigns. */
export async function listAdminPushCampaigns(c: Context<AppEnv>) {
  const q = listQuerySchema.parse(c.req.query());
  const r = await pushCampaignRepo.listPaged(q);
  return respondOk(c, {
    items: r.items,
    pagination: { limit: r.limit, total: r.total, nextCursor: r.nextCursor },
  });
}

/** GET /admin/push/campaigns/:id — one campaign with its rollup counts. */
export async function getAdminPushCampaign(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const campaign = await pushCampaignRepo.findRowById(id);
  if (!campaign) throw new NotFoundError("Campaign not found");
  return respondOk(c, { campaign });
}

/** POST /admin/push/audience-estimate — dry-run audience size before sending. */
export async function estimateAdminPushAudience(c: Context<AppEnv>) {
  const { segment } = adminAudienceEstimatePayloadSchema.parse(getValidatedInput(c, "json"));
  const estimate = await pushCampaignRepo.estimateAudience(segment);
  return respondOk(c, estimate);
}

/** POST /admin/push/campaigns — create a draft/scheduled campaign (support+, audited). */
export async function createAdminPushCampaign(c: Context<AppEnv>) {
  const input = adminCreateCampaignPayloadSchema.parse(getValidatedInput(c, "json"));
  if (input.scheduledAt && !env.ADMIN_PUSH_LIFECYCLE_ENABLED)
    throw new ConflictError("Push campaign lifecycle is disabled");
  const a = audit(c);
  const campaign = await createCampaign(input, a.actorAdminEmail);
  await adminAuditLogRepo.append({
    actorAdminEmail: a.actorAdminEmail,
    action: "push_campaign.create",
    targetType: "push_campaign",
    targetId: campaign.id,
    after: { title: campaign.title, status: campaign.status, segment: campaign.segment },
    requestId: a.requestId,
    ip: a.ip,
  });
  return respondOk(c, { campaign }, "Campaign created", 201);
}

/** POST /admin/push/campaigns/:id/send — enqueue the broadcast (admin-only, audited). */
export async function sendAdminPushCampaign(c: Context<AppEnv>) {
  if (!env.ADMIN_PUSH_LIFECYCLE_ENABLED)
    throw new ConflictError("Push campaign lifecycle is disabled");
  const id = c.req.param("id") ?? "";
  const campaign = await sendCampaign(id);
  const a = audit(c);
  await adminAuditLogRepo.append({
    actorAdminEmail: a.actorAdminEmail,
    action: "push_campaign.send",
    targetType: "push_campaign",
    targetId: id,
    after: { title: campaign.title, segment: campaign.segment },
    requestId: a.requestId,
    ip: a.ip,
  });
  return respondOk(c, { campaign }, "Campaign send enqueued", 202);
}

export async function updateAdminPushCampaign(c: Context<AppEnv>) {
  if (!env.ADMIN_PUSH_LIFECYCLE_ENABLED)
    throw new ConflictError("Push campaign lifecycle is disabled");
  const id = c.req.param("id") ?? "";
  const input = adminUpdateCampaignPayloadSchema.parse(getValidatedInput(c, "json"));
  const campaign = await updateDraftCampaign(id, input);
  await adminAuditLogRepo.append({
    ...audit(c),
    action: "push_campaign.update",
    targetType: "push_campaign",
    targetId: id,
    after: { title: campaign.title, status: campaign.status, segment: campaign.segment },
  });
  return respondOk(c, { campaign }, "Campaign updated");
}

export async function cancelAdminPushCampaign(c: Context<AppEnv>) {
  if (!env.ADMIN_PUSH_LIFECYCLE_ENABLED)
    throw new ConflictError("Push campaign lifecycle is disabled");
  const id = c.req.param("id") ?? "";
  adminCampaignCancelPayloadSchema.parse(getValidatedInput(c, "json"));
  const campaign = await cancelScheduledCampaign(id);
  await adminAuditLogRepo.append({
    ...audit(c),
    action: "push_campaign.cancel",
    targetType: "push_campaign",
    targetId: id,
  });
  return respondOk(c, { campaign }, "Campaign canceled");
}

export async function testAdminPushCampaign(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  adminCampaignTestPayloadSchema.parse(getValidatedInput(c, "json"));
  if (!env.ADMIN_PUSH_TEST_ENABLED) throw new ConflictError("Push test sends are disabled");
  const idempotencyKey = c.req.header("Idempotency-Key")?.trim();
  if (!idempotencyKey) throw new ConflictError("Idempotency-Key is required");
  const reservation = await adminActionIdempotencyRepo.reserve(
    "push_campaign.test",
    id,
    idempotencyKey
  );
  if (!reservation.created) {
    if (!reservation.row.response)
      throw new ConflictError("This test request is still in progress");
    return respondOk(
      c,
      reservation.row.response,
      reservation.row.responseMessage,
      reservation.row.responseStatus as 202
    );
  }
  try {
    const campaign = await queueCampaignTest(id, idempotencyKey);
    const a = audit(c);
    await adminAuditLogRepo.append({
      ...a,
      action: "push_campaign.test",
      targetType: "push_campaign",
      targetId: id,
      after: { title: campaign.title, outcome: "queued" },
    });
    const result = { campaign };
    await adminActionIdempotencyRepo.complete(
      reservation.row.id,
      result,
      "Test push enqueued",
      202
    );
    return respondOk(c, result, "Test push enqueued", 202);
  } catch (error) {
    await adminActionIdempotencyRepo.release(reservation.row.id);
    throw error;
  }
}

import type { Context } from "hono";
import { z } from "zod";
import {
  adminAudienceEstimatePayloadSchema,
  adminCreateCampaignPayloadSchema,
} from "../../contracts/src/admin-push";
import { NotFoundError } from "../lib/errors";
import { respondOk } from "../lib/response";
import { getClientIp } from "../lib/request-ip";
import { getValidatedInput } from "../middleware/validate";
import { pushCampaignRepo } from "../repositories";
import * as adminAuditLogRepo from "../repositories/admin-audit-log.repository";
import { createCampaign, sendCampaign } from "../services/admin-push.service";
import type { AppEnv } from "../types/http";

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

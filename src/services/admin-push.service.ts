import type {
  AdminCreateCampaignPayload,
  AdminPushCampaignRow,
} from "../../contracts/src/admin-push";
import { ConflictError, NotFoundError } from "../lib/errors";
import { enqueue, QUEUE_NAMES } from "../lib/queue";
import { pushCampaignRepo } from "../repositories";
import type { AdminUpdateCampaignPayload } from "../../contracts/src/admin-push";
import { logger } from "../lib/logger";
import { env } from "../env";

/** Create a draft (or scheduled) campaign. Sending is a separate explicit step. */
export async function createCampaign(
  input: AdminCreateCampaignPayload,
  adminEmail: string
): Promise<AdminPushCampaignRow> {
  const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
  return pushCampaignRepo.create({
    title: input.title,
    body: input.body,
    deepLink: input.deepLink ?? null,
    segment: input.segment,
    status: scheduledAt ? "scheduled" : "draft",
    scheduledAt,
    createdByAdminEmail: adminEmail,
  });
}

/**
 * Trigger a send: flip the campaign to `sending` and enqueue the fan-out job
 * (the worker resolves recipients + sends in Expo-sized batches). Only a
 * draft/scheduled campaign can be sent; the status flip is the idempotency guard
 * against a double-send. Returns the campaign in its new `sending` state.
 */
export async function sendCampaign(id: string): Promise<AdminPushCampaignRow> {
  const campaign = await pushCampaignRepo.claimForManualSend(id);
  if (!campaign) {
    const current = await pushCampaignRepo.findById(id);
    if (!current) throw new NotFoundError("Campaign not found");
    throw new ConflictError(`Campaign cannot be sent from status "${current.status}"`);
  }

  try {
    await enqueue(QUEUE_NAMES.nudges, "send-campaign", { campaignId: id });
  } catch (error) {
    const restoreStatus =
      campaign.scheduledAt && new Date(campaign.scheduledAt).getTime() > Date.now()
        ? "scheduled"
        : "draft";
    await pushCampaignRepo.restoreAfterEnqueueFailure(id, restoreStatus);
    throw error;
  }

  const updated = await pushCampaignRepo.findRowById(id);
  if (!updated) throw new NotFoundError("Campaign not found");
  return updated;
}

export async function updateDraftCampaign(
  id: string,
  input: AdminUpdateCampaignPayload
): Promise<AdminPushCampaignRow> {
  const row = await pushCampaignRepo.updateDraft(id, {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.body !== undefined ? { body: input.body } : {}),
    ...(input.deepLink !== undefined ? { deepLink: input.deepLink } : {}),
    ...(input.segment !== undefined ? { segment: input.segment } : {}),
    ...(input.scheduledAt !== undefined
      ? { scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null }
      : {}),
  });
  if (!row) throw new ConflictError("Only draft campaigns can be edited");
  return (await pushCampaignRepo.findRowById(id)) as AdminPushCampaignRow;
}

export async function cancelScheduledCampaign(id: string): Promise<AdminPushCampaignRow> {
  const row = await pushCampaignRepo.cancelScheduled(id);
  if (!row) throw new ConflictError("Only scheduled campaigns can be canceled");
  return (await pushCampaignRepo.findRowById(id)) as AdminPushCampaignRow;
}

export async function queueCampaignTest(
  id: string,
  idempotencyKey: string
): Promise<AdminPushCampaignRow> {
  const campaign = await pushCampaignRepo.findRowById(id);
  if (!campaign) throw new NotFoundError("Campaign not found");
  if (campaign.status !== "draft" && campaign.status !== "scheduled")
    throw new ConflictError("Only draft or scheduled campaigns can be tested");
  await enqueue(
    QUEUE_NAMES.nudges,
    "send-campaign-test",
    { campaignId: id },
    { jobId: `admin-push-test:${id}:${idempotencyKey}` }
  );
  return campaign;
}

export async function dispatchDueCampaigns(): Promise<number> {
  if (!env.ADMIN_PUSH_LIFECYCLE_ENABLED) return 0;
  const claimed = await pushCampaignRepo.claimDueScheduled();
  let enqueued = 0;
  for (const campaign of claimed) {
    try {
      await enqueue(QUEUE_NAMES.nudges, "send-campaign", { campaignId: campaign.id });
      enqueued += 1;
    } catch (error) {
      await pushCampaignRepo.restoreAfterEnqueueFailure(campaign.id, "scheduled");
      // Continue dispatching the remaining due campaigns; the maintenance
      // scheduler will retry this campaign on its next tick.
      logger.error({ campaignId: campaign.id, error }, "scheduled campaign enqueue failed");
    }
  }
  return enqueued;
}

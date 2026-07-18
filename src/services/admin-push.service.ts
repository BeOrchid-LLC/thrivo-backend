import type {
  AdminCreateCampaignPayload,
  AdminPushCampaignRow,
} from "../../contracts/src/admin-push";
import { ConflictError, NotFoundError } from "../lib/errors";
import { enqueue, QUEUE_NAMES } from "../lib/queue";
import { pushCampaignRepo } from "../repositories";

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
  const campaign = await pushCampaignRepo.findById(id);
  if (!campaign) throw new NotFoundError("Campaign not found");
  if (campaign.status !== "draft" && campaign.status !== "scheduled") {
    throw new ConflictError(`Campaign cannot be sent from status "${campaign.status}"`);
  }

  await pushCampaignRepo.setStatus(id, "sending");
  await enqueue(QUEUE_NAMES.nudges, "send-campaign", { campaignId: id });

  const updated = await pushCampaignRepo.findRowById(id);
  if (!updated) throw new NotFoundError("Campaign not found");
  return updated;
}

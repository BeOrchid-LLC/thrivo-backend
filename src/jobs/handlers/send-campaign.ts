import type { Job } from "bullmq";
import { logger } from "../../lib/logger";
import { pushCampaignRepo, pushTokenRepo } from "../../repositories";
import type { AdminPushSegment } from "../../../contracts/src/admin-push";
import { EXPO_MAX_PER_REQUEST, sendExpoPushBatch } from "../../integrations/expo-push";

interface SendCampaignJob {
  campaignId: string;
}

/**
 * Fan out a push campaign to every active token matching its segment. Resolves
 * recipients, writes the per-recipient ledger, then sends in Expo-sized batches,
 * marking each recipient sent/failed and pruning DeviceNotRegistered tokens.
 * Guarded on `status === "sending"` so a re-delivered job can't double-send.
 */
export async function handleSendCampaign(job: Job): Promise<void> {
  const { campaignId } = job.data as SendCampaignJob;
  const campaign = await pushCampaignRepo.findById(campaignId);
  if (!campaign) {
    logger.warn({ campaignId }, "send-campaign: campaign not found");
    return;
  }
  if (campaign.status !== "sending") {
    logger.info(
      { campaignId, status: campaign.status },
      "send-campaign: not in sending state, skip"
    );
    return;
  }

  const segment = campaign.segment as AdminPushSegment;
  const recipients = await pushCampaignRepo.resolveRecipients(segment);
  await pushCampaignRepo.insertRecipients(campaignId, recipients);
  await pushCampaignRepo.setStatus(campaignId, "sending", {
    recipientCount: (await pushCampaignRepo.recipientCounts(campaignId)).recipientCount,
  });

  let sent = 0;
  let failed = 0;
  const dead: string[] = [];

  while (true) {
    const batch = await pushCampaignRepo.claimQueuedRecipients(campaignId, EXPO_MAX_PER_REQUEST);
    if (batch.length === 0) break;
    const messages = batch.map((r) => ({
      to: r.token,
      title: campaign.title,
      body: campaign.body,
      data: campaign.deepLink ? { deepLink: campaign.deepLink } : undefined,
    }));
    try {
      const { invalidTokens } = await sendExpoPushBatch(messages);
      const invalid = new Set(invalidTokens);
      await pushCampaignRepo.markRecipients(
        campaignId,
        batch.filter((r) => !invalid.has(r.token)).map((r) => r.id),
        "sent",
        null,
        batch[0]!.processingToken
      );
      if (invalidTokens.length > 0) {
        await pushCampaignRepo.markRecipients(
          campaignId,
          batch.filter((r) => invalid.has(r.token)).map((r) => r.id),
          "failed",
          "DeviceNotRegistered",
          batch[0]!.processingToken
        );
        dead.push(...invalidTokens);
      }
      sent += batch.filter((r) => !invalid.has(r.token)).length;
      failed += invalidTokens.length;
    } catch (err) {
      await pushCampaignRepo.markRecipients(
        campaignId,
        batch.map((r) => r.id),
        "failed",
        err instanceof Error ? err.message : String(err),
        batch[0]!.processingToken
      );
      failed += batch.length;
    }
  }

  if (dead.length > 0) await pushTokenRepo.pruneInvalid(dead);

  const counts = await pushCampaignRepo.recipientCounts(campaignId);
  if (counts.queuedCount > 0 || counts.processingCount > 0) {
    logger.info(
      { campaignId, queued: counts.queuedCount, processing: counts.processingCount },
      "send-campaign waiting for another worker claim"
    );
    return;
  }
  const finalStatus =
    counts.recipientCount > 0 && counts.failedCount === counts.recipientCount ? "failed" : "sent";
  await pushCampaignRepo.setStatus(campaignId, finalStatus, {
    recipientCount: counts.recipientCount,
    sentCount: counts.sentCount,
    failedCount: counts.failedCount,
    sentAt: new Date(),
  });
  logger.info({ campaignId, sent, failed, finalStatus }, "send-campaign complete");
}

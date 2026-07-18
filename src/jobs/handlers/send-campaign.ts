import type { Job } from "bullmq";
import { logger } from "../../lib/logger";
import { pushCampaignRepo, pushTokenRepo } from "../../repositories";
import type { AdminPushSegment } from "../../../contracts/src/admin-push";
import { chunk, EXPO_MAX_PER_REQUEST, sendExpoPushBatch } from "../../integrations/expo-push";

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
  await pushCampaignRepo.setStatus(campaignId, "sending", { recipientCount: recipients.length });

  let sent = 0;
  let failed = 0;
  const dead: string[] = [];

  for (const batch of chunk(recipients, EXPO_MAX_PER_REQUEST)) {
    const messages = batch.map((r) => ({
      to: r.token,
      title: campaign.title,
      body: campaign.body,
      data: campaign.deepLink ? { deepLink: campaign.deepLink } : undefined,
    }));
    try {
      const { invalidTokens } = await sendExpoPushBatch(messages);
      const invalid = new Set(invalidTokens);
      const okTokens = batch.map((r) => r.token).filter((t) => !invalid.has(t));
      await pushCampaignRepo.markRecipients(campaignId, okTokens, "sent");
      if (invalidTokens.length > 0) {
        await pushCampaignRepo.markRecipients(
          campaignId,
          invalidTokens,
          "failed",
          "DeviceNotRegistered"
        );
        dead.push(...invalidTokens);
      }
      sent += okTokens.length;
      failed += invalidTokens.length;
    } catch (err) {
      const tokens = batch.map((r) => r.token);
      await pushCampaignRepo.markRecipients(
        campaignId,
        tokens,
        "failed",
        err instanceof Error ? err.message : String(err)
      );
      failed += tokens.length;
    }
  }

  if (dead.length > 0) await pushTokenRepo.pruneInvalid(dead);

  const finalStatus = recipients.length > 0 && failed === recipients.length ? "failed" : "sent";
  await pushCampaignRepo.setStatus(campaignId, finalStatus, {
    sentCount: sent,
    failedCount: failed,
    sentAt: new Date(),
  });
  logger.info({ campaignId, sent, failed, finalStatus }, "send-campaign complete");
}

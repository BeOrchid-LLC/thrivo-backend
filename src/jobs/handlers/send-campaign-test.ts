import type { Job } from "bullmq";
import { env } from "../../env";
import { logger } from "../../lib/logger";
import { pushCampaignRepo, pushTokenRepo, userRepo } from "../../repositories";
import { chunk, EXPO_MAX_PER_REQUEST, sendExpoPushBatch } from "../../integrations/expo-push";

export async function handleSendCampaignTest(job: Job): Promise<void> {
  const campaignId = (job.data as { campaignId: string }).campaignId;
  if (!env.ADMIN_PUSH_TEST_ENABLED) {
    logger.warn({ campaignId }, "push test skipped: feature flag disabled");
    return;
  }
  const campaign = await pushCampaignRepo.findById(campaignId);
  if (!campaign) return;
  const emails = env.ADMIN_PUSH_TEST_USER_EMAILS;
  if (emails.length === 0) {
    logger.warn({ campaignId }, "push test skipped: no internal test recipients configured");
    return;
  }
  const users = await userRepo.findActiveByEmails(emails);
  if (users.length < emails.length) {
    logger.warn(
      { campaignId, configuredRecipientCount: emails.length, resolvedRecipientCount: users.length },
      "push test has configured recipients that do not resolve to active users"
    );
  }
  const tokens = (await Promise.all(users.map((user) => pushTokenRepo.listForUser(user.id))))
    .flat()
    .filter((token) => token.isActive)
    .map((token) => token.expoPushToken);
  for (const batch of chunk(tokens, EXPO_MAX_PER_REQUEST)) {
    const { invalidTokens } = await sendExpoPushBatch(
      batch.map((to) => ({
        to,
        title: campaign.title,
        body: campaign.body,
        data: campaign.deepLink ? { deepLink: campaign.deepLink } : undefined,
      }))
    );
    if (invalidTokens.length > 0) await pushTokenRepo.pruneInvalid(invalidTokens);
  }
  logger.info(
    {
      campaignId,
      configuredRecipientCount: emails.length,
      resolvedRecipientCount: users.length,
      tokenCount: tokens.length,
    },
    "push test complete"
  );
}

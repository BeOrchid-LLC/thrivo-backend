import type { Job } from "bullmq";
import { pushTokenRepo, notificationDeliveryRepo } from "../../repositories";
import { sendExpoPushBatch, type ExpoPushMessage } from "../../integrations/expo-push";
import type { FoodLogReminderJobData } from "../../services/food-log-reminder.service";
import { logger } from "../../lib/logger";

export async function handleSendFoodLogReminder(job: Job<FoodLogReminderJobData>): Promise<void> {
  const { deliveryId, localDate, scheduledTime, tokens } = job.data;
  const messages: ExpoPushMessage[] = tokens.map((to) => ({
    to,
    title: "Log your food",
    body: "Take a moment to log what you've eaten.",
    data: { screen: "log", localDate, scheduledTime, deliveryId },
  }));

  try {
    const { invalidTokens } = await sendExpoPushBatch(messages);
    if (invalidTokens.length > 0) await pushTokenRepo.pruneInvalid(invalidTokens);
    await notificationDeliveryRepo.markSent(deliveryId);
    logger.info({ jobId: job.id, deliveryId, tokenCount: tokens.length }, "food-log reminder sent");
  } catch (error) {
    await notificationDeliveryRepo.markFailed(deliveryId, error);
    throw error;
  }
}

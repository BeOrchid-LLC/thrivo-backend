import type { Job } from "bullmq";
import { webhookEventRepo } from "../../repositories";

export async function handleRedactWebhookPayloads(_job: Job): Promise<void> {
  const before = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await webhookEventRepo.redactExpiredPayloads(before);
}

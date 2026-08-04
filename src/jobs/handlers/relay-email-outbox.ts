import type { Job } from "bullmq";
import { db } from "../../../db";
import { env } from "../../env";
import { enqueue, getQueue, QUEUE_NAMES } from "../../lib/queue";
import { logger } from "../../lib/logger";
import { emailLogRepo, emailOutboxRepo } from "../../repositories";
import type { SendEmailJobData } from "../../services/email.service";

const BATCH_SIZE = 100;

export const EMAIL_JOB_OPTS = {
  attempts: 6,
  backoff: { type: "exponential" as const, delay: 30_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 10_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 5_000 },
};

/** Move durable intents to BullMQ. Re-running is safe because jobId is the email log id. */
export async function handleRelayEmailOutbox(_job?: Job): Promise<void> {
  const expired = await emailOutboxRepo.expirePastDue();
  if (!env.EMAIL_SENDING_ENABLED) {
    if (expired > 0) logger.info({ expired }, "expired email outbox rows while sending disabled");
    return;
  }

  const emailLogIds = await emailOutboxRepo.claimDispatchBatch(BATCH_SIZE);
  let dispatched = 0;
  for (const emailLogId of emailLogIds) {
    try {
      const data: SendEmailJobData = { emailLogId };
      const existing = await getQueue(QUEUE_NAMES.emails).getJob(emailLogId);
      const existingState = await existing?.getState();
      const attempts = existing?.opts.attempts ?? 1;
      if (existingState === "failed" && (existing?.attemptsMade ?? 0) >= attempts) {
        await db.transaction(async (tx) => {
          await emailLogRepo.markTerminalFailure(
            emailLogId,
            "failed",
            "retry_exhausted",
            "Email delivery retry horizon exhausted",
            tx
          );
          await emailOutboxRepo.complete(emailLogId, "failed", tx);
        });
        await existing?.remove();
        continue;
      }
      if (existingState === "failed" || existingState === "completed") {
        await existing?.remove();
      }
      if (!existing || existingState === "failed" || existingState === "completed") {
        await enqueue(QUEUE_NAMES.emails, "send-email", data, {
          ...EMAIL_JOB_OPTS,
          jobId: emailLogId,
        });
      }
      await emailOutboxRepo.markDispatched(emailLogId);
      dispatched += 1;
    } catch (err) {
      await emailOutboxRepo.releaseForDispatch(emailLogId);
      logger.error({ err, emailLogId }, "email outbox dispatch failed");
    }
  }
  if (dispatched > 0 || expired > 0) {
    logger.info(
      { claimed: emailLogIds.length, dispatched, expired },
      "email outbox relay complete"
    );
  }
}

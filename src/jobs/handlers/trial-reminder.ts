import type { Job } from "bullmq";
import { subscriptionRepo, userRepo } from "../../repositories";
import { queueTemplatedEmail } from "../../services/email.service";
import { logger } from "../../lib/logger";
import { emailAppLink } from "../../lib/email/links";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Email users whose free trial ends within the next ~24h. Run daily; the 24h
 * window is one run wide, so a given trial is reminded roughly once before it
 * converts or lapses.
 */
export async function handleTrialReminder(_job: Job): Promise<void> {
  const now = new Date();
  const ending = await subscriptionRepo.listTrialsEndingWithin(
    now,
    new Date(now.getTime() + DAY_MS)
  );

  let queued = 0;
  let failed = 0;
  for (const sub of ending) {
    try {
      const user = await userRepo.findById(sub.userId);
      if (!user?.email || !user.emailVerified || !sub.trialEnd) continue;
      await queueTemplatedEmail({
        kind: "trial_ending",
        to: user.email,
        userId: user.id,
        resendable: true,
        dedupeKey: `trial-ending:${sub.id}:${sub.trialEnd.toISOString()}`,
        expiresAt: new Date(Date.now() + DAY_MS),
        template: "notification",
        props: {
          title: "Your Thrivo trial is ending soon",
          body: "Your free trial wraps up within a day. Keep your streak and premium insights going by choosing a plan.",
          cta: { label: "View plans", url: emailAppLink("subscription") },
        },
      });
      queued += 1;
    } catch (err) {
      failed += 1;
      logger.error(
        { err, subscriptionId: sub.id, userId: sub.userId },
        "trial reminder queue failed"
      );
    }
  }

  if (ending.length > 0)
    logger.info({ eligible: ending.length, queued, failed }, "trial reminders queued");
}

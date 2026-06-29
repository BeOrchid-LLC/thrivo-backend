import type { Job } from "bullmq";
import { subscriptionRepo, userRepo } from "../../repositories";
import { sendTemplatedEmail } from "../../services/email.service";
import { logger } from "../../lib/logger";

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

  for (const sub of ending) {
    const user = await userRepo.findById(sub.userId);
    if (!user?.email) continue;
    await sendTemplatedEmail({
      to: user.email,
      userId: user.id,
      template: "notification",
      props: {
        title: "Your Thrivo trial is ending soon",
        body: "Your free trial wraps up within a day. Keep your streak and premium insights going by choosing a plan.",
        cta: { label: "View plans", url: "https://thrivo.fit/app/subscription" },
      },
    });
  }

  if (ending.length > 0) logger.info({ reminded: ending.length }, "trial reminders queued");
}

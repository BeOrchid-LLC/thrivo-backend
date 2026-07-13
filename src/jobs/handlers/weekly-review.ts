import type { Job } from "bullmq";
import { emailLogRepo, settingsRepo, userRepo } from "../../repositories";
import { sendTemplatedEmail } from "../../services/email.service";
import { getWeeklyReviewStats, hasLoggedToday } from "../../services/weekly-review.service";
import { logger } from "../../lib/logger";

const PAGE_SIZE = 200;
// Matches the existing push nudge's 8am UTC default and dailyFoodLogReminderTime's
// "08:00" default — not yet wired to each user's own customizable reminder time.
const TARGET_LOCAL_HOUR = 8;
// Comfortably less than 24h so a retrigger within the same send doesn't double-send,
// but tomorrow's run at the same local hour is never blocked by it.
const DEDUPE_WINDOW_MS = 20 * 60 * 60 * 1000;

/**
 * Hourly maintenance job: at any given UTC instant, pages users whose local
 * clock currently reads `TARGET_LOCAL_HOUR` (per-timezone-bucketed send — see
 * userRepo.listEligibleForWeeklyReviewPage) and emails the ones who haven't
 * logged food on their local "today" yet. A missing global_settings row
 * counts as enabled, same convention as the rest of settings-gated sends.
 */
export async function handleWeeklyReview(_job: Job): Promise<void> {
  const global = await settingsRepo.getGlobalSettings();
  if (global && !global.emailFoodLogReminderEnabled) {
    logger.info("weekly-review run skipped: disabled globally");
    return;
  }

  const now = new Date();
  let cursor: string | null = null;
  let sent = 0;
  let skippedLogged = 0;
  let skippedDuplicate = 0;

  for (;;) {
    const page = await userRepo.listEligibleForWeeklyReviewPage(
      TARGET_LOCAL_HOUR,
      cursor,
      PAGE_SIZE
    );
    if (page.length === 0) break;

    for (const candidate of page) {
      if (await hasLoggedToday(candidate.id, candidate.timezone, now)) {
        skippedLogged += 1;
        continue;
      }
      const dedupeSince = new Date(now.getTime() - DEDUPE_WINDOW_MS);
      if (await emailLogRepo.hasRecentSend(candidate.id, "weekly-review", dedupeSince)) {
        skippedDuplicate += 1;
        continue;
      }

      const stats = await getWeeklyReviewStats(candidate.id, candidate.timezone, now);
      await sendTemplatedEmail({
        to: candidate.email,
        userId: candidate.id,
        template: "weekly-review",
        props: { loggedThisWeek: stats.loggedThisWeek, loggedLastWeek: stats.loggedLastWeek },
      });
      sent += 1;
    }

    cursor = page[page.length - 1]!.id;
    if (page.length < PAGE_SIZE) break;
  }

  if (sent > 0 || skippedLogged > 0 || skippedDuplicate > 0) {
    logger.info(
      { sent, skippedLogged, skippedDuplicate, targetLocalHour: TARGET_LOCAL_HOUR },
      "weekly-review run complete"
    );
  }
}

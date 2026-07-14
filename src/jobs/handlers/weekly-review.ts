import type { Job } from "bullmq";
import { emailLogRepo, settingsRepo, userRepo } from "../../repositories";
import { sendTemplatedEmail } from "../../services/email.service";
import { getWeeklyReviewBatch } from "../../services/weekly-review.service";
import { logger } from "../../lib/logger";

const PAGE_SIZE = 200;
const SEND_CONCURRENCY = 8;
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
  let skippedUnsupportedTimezone = 0;
  let failed = 0;

  for (;;) {
    const page = await userRepo.listEligibleForWeeklyReviewPage(
      TARGET_LOCAL_HOUR,
      cursor,
      PAGE_SIZE
    );
    if (page.length === 0) break;

    const review = await getWeeklyReviewBatch(page, now);
    skippedUnsupportedTimezone += review.skippedUnsupportedTimezone;
    const recentSends = await emailLogRepo.listRecentSends(
      page.map((candidate) => candidate.id),
      "weekly-review",
      new Date(now.getTime() - DEDUPE_WINDOW_MS)
    );

    const toSend: Array<{
      candidate: (typeof page)[number];
      stats: NonNullable<ReturnType<typeof review.byUserId.get>>;
    }> = [];
    for (const candidate of page) {
      const stats = review.byUserId.get(candidate.id);
      if (!stats) continue;

      if (stats.loggedToday) {
        skippedLogged += 1;
        continue;
      }
      if (recentSends.has(candidate.id)) {
        skippedDuplicate += 1;
        continue;
      }
      toSend.push({ candidate, stats });
    }

    // Each user's render/queue operation is independent after the batch reads and
    // dedupe gate. Bound the fan-out so a full page does not create 200 concurrent
    // provider/queue operations; failures remain isolated to their user.
    let nextSend = 0;
    const sendWorker = async (): Promise<void> => {
      for (;;) {
        const item = toSend[nextSend++];
        if (!item) return;
        try {
          await sendTemplatedEmail({
            to: item.candidate.email,
            userId: item.candidate.id,
            template: "weekly-review",
            props: {
              loggedThisWeek: item.stats.loggedThisWeek,
              loggedLastWeek: item.stats.loggedLastWeek,
            },
          });
          sent += 1;
        } catch (err) {
          failed += 1;
          logger.error({ err, userId: item.candidate.id }, "weekly-review send failed");
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(SEND_CONCURRENCY, toSend.length) }, () => sendWorker())
    );

    cursor = page[page.length - 1]!.id;
    if (page.length < PAGE_SIZE) break;
  }

  if (
    sent > 0 ||
    skippedLogged > 0 ||
    skippedDuplicate > 0 ||
    skippedUnsupportedTimezone > 0 ||
    failed > 0
  ) {
    logger.info(
      {
        sent,
        skippedLogged,
        skippedDuplicate,
        skippedUnsupportedTimezone,
        failed,
        targetLocalHour: TARGET_LOCAL_HOUR,
      },
      "weekly-review run complete"
    );
  }
}

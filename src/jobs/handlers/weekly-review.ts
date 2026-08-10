import type { Job } from "bullmq";
import { settingsRepo, userRepo } from "../../repositories";
import { queueTemplatedEmail } from "../../services/email.service";
import { getWeeklyReviewBatch } from "../../services/weekly-review.service";
import { emailAppLink } from "../../lib/email/links";
import { shiftLocalDate, startOfLocalDateUtc } from "../../lib/local-date";
import { logger } from "../../lib/logger";
import { env } from "../../env";

const PAGE_SIZE = 200;
const SEND_CONCURRENCY = 8;

/** Every 15 minutes; DB eligibility selects local Sunday at/after 09:00. */
export async function handleWeeklyReview(
  _job: Job,
  options: { dryRun?: boolean } = {}
): Promise<void> {
  const dryRun = options.dryRun ?? env.WEEKLY_REVIEW_DRY_RUN;
  const global = await settingsRepo.getGlobalSettings();
  if (global && !global.weeklyReviewEmailEnabled) {
    logger.info("weekly-review run skipped: disabled globally");
    return;
  }

  const now = new Date();
  let cursor: string | null = null;
  let queued = 0;
  let dryRunEligible = 0;
  let skippedUnsupportedTimezone = 0;
  let failed = 0;

  for (;;) {
    const page = await userRepo.listEligibleForWeeklyReviewPage(now, cursor, PAGE_SIZE);
    if (page.length === 0) break;
    const review = await getWeeklyReviewBatch(page, now);
    skippedUnsupportedTimezone += review.skippedUnsupportedTimezone;
    const toSend = page.flatMap((candidate) => {
      const stats = review.byUserId.get(candidate.id);
      return stats ? [{ candidate, stats }] : [];
    });

    if (dryRun) {
      dryRunEligible += toSend.length;
      cursor = page[page.length - 1]!.id;
      if (page.length < PAGE_SIZE) break;
      continue;
    }

    let nextSend = 0;
    const sendWorker = async (): Promise<void> => {
      for (;;) {
        const item = toSend[nextSend++];
        if (!item) return;
        try {
          const nextLocalDate = shiftLocalDate(item.stats.sendLocalDate, 1);
          await queueTemplatedEmail({
            kind: "weekly_review",
            to: item.candidate.email,
            userId: item.candidate.id,
            template: "weekly-review",
            dedupeKey: `weekly-review:${item.candidate.id}:${item.stats.periodStart}`,
            expiresAt: startOfLocalDateUtc(nextLocalDate, item.candidate.timezone),
            props: {
              periodStart: item.stats.periodStart,
              periodEnd: item.stats.periodEnd,
              loggedDays: item.stats.loggedDays,
              previousLoggedDays: item.stats.previousLoggedDays,
              includeComparison: item.stats.includeComparison,
              joinedDuringPeriod: item.stats.joinedDuringPeriod,
              progressUrl: emailAppLink("metrics"),
            },
          });
          queued += 1;
        } catch (err) {
          failed += 1;
          logger.error({ err, userId: item.candidate.id }, "weekly-review queue failed");
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(SEND_CONCURRENCY, toSend.length) }, () => sendWorker())
    );

    cursor = page[page.length - 1]!.id;
    if (page.length < PAGE_SIZE) break;
  }

  if (queued > 0 || dryRunEligible > 0 || skippedUnsupportedTimezone > 0 || failed > 0) {
    logger.info(
      {
        queued,
        dryRunEligible,
        dryRun,
        skippedUnsupportedTimezone,
        failed,
        targetLocalTime: "Sunday 09:00",
      },
      "weekly-review run complete"
    );
  }
}

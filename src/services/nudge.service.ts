import { logger } from "../lib/logger";
import { pushTokenRepo, tipRepo } from "../repositories";
import { chunk, EXPO_MAX_PER_REQUEST } from "../integrations/expo-push";
import { enqueue, QUEUE_NAMES } from "../lib/queue";
import type { Tip } from "../repositories/tip.repository";
import { getGlobalSettings } from "./settings.service";

const TOKEN_PAGE_SIZE = 500; // DB keyset page — chunked further into Expo-sized batches below

/** One BullMQ job per Expo-sized batch; a retry only re-sends this batch (R5-3/I15). */
export type NudgeChunkJobData = {
  tipId: string;
  tipBody: string;
  tokens: string[];
};

// Failed chunks are kept (not dropped) as the de-facto DLQ, same convention as
// EMAIL_JOB_OPTS — poison chunks stay visible for inspection instead of vanishing.
const NUDGE_CHUNK_JOB_OPTS = {
  attempts: 4,
  backoff: { type: "exponential" as const, delay: 5000 },
  removeOnComplete: true,
  removeOnFail: false,
};

function isoDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The day's tip. A staff-pinned tip for the date wins; otherwise rotate
 * deterministically over the active bank by absolute day number, so the whole
 * cohort sees the same tip and it advances exactly once per day.
 */
export async function selectDailyTip(localDate = isoDay()): Promise<Tip | null> {
  const pinned = await tipRepo.getPinnedForDate(localDate);
  if (pinned) return pinned;

  const active = await tipRepo.listActive();
  if (active.length === 0) return null;

  const dayNumber = Math.floor(Date.parse(`${localDate}T00:00:00Z`) / 86_400_000);
  return active[dayNumber % active.length] ?? null;
}

export interface NudgeDispatchResult {
  tipId: string | null;
  chunksEnqueued: number;
  tokensQueued: number;
}

/**
 * Dispatcher for the daily nudge (R5-3/I15). Pages eligible tokens by keyset
 * cursor (bounded memory — never loads all active tokens at once) and enqueues
 * one BullMQ job per Expo-sized batch instead of sending inline. This replaces
 * the old single monolithic send: a 5xx mid-run used to throw and BullMQ would
 * retry the *whole* job from batch zero (duplicate-storming everything already
 * delivered); now a retry only touches the one chunk that failed.
 */
export async function sendDailyNudges(localDate = isoDay()): Promise<NudgeDispatchResult> {
  const global = await getGlobalSettings();
  if (!global.pushNotificationsEnabled || !global.psychologyTipPushEnabled) {
    logger.info("psychology-tip pushes disabled; daily nudge skipped");
    return { tipId: null, chunksEnqueued: 0, tokensQueued: 0 };
  }
  const tip = await selectDailyTip(localDate);
  if (!tip) {
    logger.warn("no active tips; daily nudge skipped");
    return { tipId: null, chunksEnqueued: 0, tokensQueued: 0 };
  }

  let cursor: string | null = null;
  let chunksEnqueued = 0;
  let tokensQueued = 0;

  for (;;) {
    const page = await pushTokenRepo.listActiveForNudgesPage(cursor, TOKEN_PAGE_SIZE);
    if (page.length === 0) break;

    for (const batch of chunk(page, EXPO_MAX_PER_REQUEST)) {
      const data: NudgeChunkJobData = {
        tipId: tip.id,
        tipBody: tip.body,
        tokens: batch.map((token) => token.expoPushToken),
      };
      await enqueue(QUEUE_NAMES.nudges, "send-nudge-chunk", data, NUDGE_CHUNK_JOB_OPTS);
      chunksEnqueued += 1;
      tokensQueued += batch.length;
    }

    cursor = page[page.length - 1]!.id;
    if (page.length < TOKEN_PAGE_SIZE) break;
  }

  const result: NudgeDispatchResult = { tipId: tip.id, chunksEnqueued, tokensQueued };
  logger.info(result, "daily nudges dispatched");
  return result;
}

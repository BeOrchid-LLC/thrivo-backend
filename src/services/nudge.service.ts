import { logger } from "../lib/logger";
import { pushTokenRepo, tipRepo } from "../repositories";
import { sendExpoPush, type ExpoPushMessage } from "../integrations/expo-push";
import type { Tip } from "../repositories/tip.repository";

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

export interface NudgeRunResult {
  tipId: string | null;
  recipients: number;
  pruned: number;
}

/** Fan the day's tip out to every eligible device, pruning tokens Expo rejects. */
export async function sendDailyNudges(localDate = isoDay()): Promise<NudgeRunResult> {
  const tip = await selectDailyTip(localDate);
  if (!tip) {
    logger.warn("no active tips; daily nudge skipped");
    return { tipId: null, recipients: 0, pruned: 0 };
  }

  const tokens = await pushTokenRepo.listActiveForNudges();
  if (tokens.length === 0) return { tipId: tip.id, recipients: 0, pruned: 0 };

  const messages: ExpoPushMessage[] = tokens.map((token) => ({
    to: token.expoPushToken,
    title: "Thrivo",
    body: tip.body,
    data: { screen: "checkin", tipId: tip.id },
  }));

  const { invalidTokens } = await sendExpoPush(messages);
  if (invalidTokens.length > 0) await pushTokenRepo.pruneInvalid(invalidTokens);

  const result: NudgeRunResult = {
    tipId: tip.id,
    recipients: tokens.length - invalidTokens.length,
    pruned: invalidTokens.length,
  };
  logger.info(result, "daily nudges sent");
  return result;
}

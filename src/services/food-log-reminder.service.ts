import { logger } from "../lib/logger";
import { enqueue, QUEUE_NAMES } from "../lib/queue";
import { notificationDeliveryRepo, pushTokenRepo } from "../repositories";
import { getGlobalSettings } from "./settings.service";

const TOKEN_PAGE_SIZE = 500;
const MISSED_TICK_LOOKBACK_MINUTES = 5;

export type FoodLogReminderJobData = {
  deliveryId: string;
  userId: string;
  localDate: string;
  scheduledTime: string;
  tokens: string[];
};

const FOOD_LOG_JOB_OPTS = {
  attempts: 4,
  backoff: { type: "exponential" as const, delay: 5000 },
  removeOnComplete: true,
  removeOnFail: false,
};

type LocalReminderKey = { localDate: string; localTime: string };

/** Convert an instant to the user's IANA local date and minute. */
export function localReminderKey(at: Date, timezone: string | null): LocalReminderKey | null {
  if (!timezone) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const hour = values.hour === "24" ? "00" : values.hour;
    if (!values.year || !values.month || !values.day || !hour || !values.minute) return null;
    return {
      localDate: `${values.year}-${values.month}-${values.day}`,
      localTime: `${hour}:${values.minute}`,
    };
  } catch {
    return null;
  }
}

function normalizeTime(value: string): string | null {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Enqueue each due user's food-log reminder at their local minute. */
export async function sendFoodLogReminders(at = new Date()) {
  const global = await getGlobalSettings();
  if (!global.pushNotificationsEnabled || !global.dailyFoodLogReminderEnabled) {
    return { groupsEnqueued: 0, tokensQueued: 0 };
  }

  const due = new Map<
    string,
    { userId: string; localDate: string; scheduledTime: string; tokens: string[] }
  >();
  let cursor: string | null = null;
  for (;;) {
    const page = await pushTokenRepo.listActiveForFoodLogRemindersPage(cursor, TOKEN_PAGE_SIZE);
    if (page.length === 0) break;
    for (const recipient of page) {
      if (!recipient.notifyTimes?.length) continue;
      const configuredTimes = new Set(
        recipient.notifyTimes.map(normalizeTime).filter((time): time is string => time !== null)
      );
      for (let offset = 0; offset <= MISSED_TICK_LOOKBACK_MINUTES; offset += 1) {
        const key = localReminderKey(new Date(at.getTime() - offset * 60_000), recipient.timezone);
        if (!key || !configuredTimes.has(key.localTime)) continue;
        const groupKey = `${recipient.userId}:${key.localDate}:${key.localTime}`;
        const group = due.get(groupKey) ?? {
          userId: recipient.userId,
          localDate: key.localDate,
          scheduledTime: key.localTime,
          tokens: [],
        };
        if (!group.tokens.includes(recipient.expoPushToken)) {
          group.tokens.push(recipient.expoPushToken);
        }
        due.set(groupKey, group);
      }
    }
    cursor = page[page.length - 1]!.tokenId;
    if (page.length < TOKEN_PAGE_SIZE) break;
  }

  let groupsEnqueued = 0;
  let tokensQueued = 0;
  for (const group of due.values()) {
    const delivery = await notificationDeliveryRepo.claim({
      userId: group.userId,
      kind: "daily_food_log",
      localDate: group.localDate,
      scheduledTime: group.scheduledTime,
    });
    if (!delivery) continue;
    try {
      await enqueue(
        QUEUE_NAMES.nudges,
        "send-food-log-reminder",
        { ...group, deliveryId: delivery.id } satisfies FoodLogReminderJobData,
        FOOD_LOG_JOB_OPTS
      );
      groupsEnqueued += 1;
      tokensQueued += group.tokens.length;
    } catch (error) {
      await notificationDeliveryRepo.markFailed(delivery.id, error);
      throw error;
    }
  }

  const result = { groupsEnqueued, tokensQueued };
  logger.info(result, "food-log reminders dispatched");
  return result;
}

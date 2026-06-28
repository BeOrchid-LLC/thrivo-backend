import { getRedis } from "../lib/redis";
import { logger } from "../lib/logger";
import { userRepo } from "../repositories";

/** At most one liveness write per user per this window. */
const THROTTLE_SECONDS = 300;

/**
 * Stamp the user's last_active_at, Redis-gated to once per window so a busy
 * client isn't a DB write per request. Fails open: a missed stamp is harmless,
 * and recording activity must never break the request it rides on. Fire-and-
 * forget from the auth middleware — it stays off the response latency path.
 */
export async function recordActivity(userId: string): Promise<void> {
  try {
    const redis = getRedis();
    // SET NX EX: only the first request in the window wins the touch.
    const fresh = await redis.set(`activity:${userId}`, "1", "EX", THROTTLE_SECONDS, "NX");
    if (fresh === "OK") await userRepo.touchLastActive(userId);
  } catch (err) {
    logger.warn({ err, userId }, "recordActivity skipped");
  }
}

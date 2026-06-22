import { randomInt } from "crypto";
import { getRedis } from "../lib/redis";
import { env } from "../env";

const KEY_PREFIX = "admin-otp:";
const TTL_SEC = 300; // 5 minutes
const MAX_ATTEMPTS = 5;
const ATTEMPT_KEY_PREFIX = "admin-otp-attempts:";

/** Returns true if the email is in the configured admin allowlist. */
export function isAllowedAdminEmail(email: string): boolean {
  return env.ADMIN_EMAILS.includes(email.toLowerCase());
}

/** Generate and persist a 6-digit OTP for an admin email. Returns the code. */
export async function issueAdminOtp(email: string): Promise<string> {
  const code = String(randomInt(100000, 999999));
  const redis = getRedis();
  await redis.set(`${KEY_PREFIX}${email}`, code, "EX", TTL_SEC);
  // Reset attempt counter when a new code is issued.
  await redis.del(`${ATTEMPT_KEY_PREFIX}${email}`);
  return code;
}

/**
 * Verify and atomically consume the OTP. Returns true if valid.
 * Increments a per-email attempt counter to prevent brute-force; the counter
 * expires with the OTP so legitimate retries after re-request are fine.
 */
export async function consumeAdminOtp(email: string, code: string): Promise<boolean> {
  const redis = getRedis();
  const attemptKey = `${ATTEMPT_KEY_PREFIX}${email}`;

  const attempts = await redis.incr(attemptKey);
  if (attempts === 1) await redis.expire(attemptKey, TTL_SEC);
  if (attempts > MAX_ATTEMPTS) return false;

  const stored = await redis.get(`${KEY_PREFIX}${email}`);
  if (!stored || stored !== code) return false;

  await redis.del(`${KEY_PREFIX}${email}`, attemptKey);
  return true;
}

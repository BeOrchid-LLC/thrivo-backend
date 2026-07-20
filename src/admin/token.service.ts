import { getRedis } from "../lib/redis";
import { logger } from "../lib/logger";
import { randomToken, sha256Hex } from "../auth/crypto";
import { env } from "../env";

/**
 * Admin-app deep links carrying the token in the query string. Built from the
 * fixed `ADMIN_APP_URL` (never user input) so they can't become open redirects.
 */
export const adminInviteLink = (email: string, token: string) =>
  `${env.ADMIN_APP_URL}/accept-invite?email=${encodeURIComponent(email)}&token=${token}`;
export const adminResetLink = (email: string, token: string) =>
  `${env.ADMIN_APP_URL}/reset-password?email=${encodeURIComponent(email)}&token=${token}`;

/**
 * Opaque, single-use invite + password-reset tokens for admins. Mirrors the
 * pinpoint approach — tokens live only in Redis, keyed by email, with a TTL and
 * single active token per email — but hashes the token at rest (sha256) as
 * defense-in-depth so a Redis dump never yields a usable link.
 *
 * The token ships in the email link's query string; only its hash is stored. On
 * accept/reset the caller passes the raw token back; we hash and compare, then
 * delete the key so it can't be replayed.
 */
export const ADMIN_INVITE_TTL_SEC = 72 * 60 * 60; // 72h — a human must act
export const ADMIN_RESET_TTL_SEC = 30 * 60; // 30m

const inviteKey = (email: string) => `admin:invite:${email.toLowerCase()}`;
const resetKey = (email: string) => `admin:pwreset:${email.toLowerCase()}`;
// Per-email reset issue throttle: 5 requests / 15 min (mirrors the OTP throttle).
const resetThrottleKey = (email: string) => `admin:pwreset-req:${email.toLowerCase()}`;
const RESET_THROTTLE_MAX = 5;
const RESET_THROTTLE_WINDOW_SEC = 15 * 60;

async function issue(redisKey: string, ttlSec: number): Promise<string> {
  const token = randomToken();
  await getRedis().set(redisKey, sha256Hex(token), "EX", ttlSec);
  return token;
}

async function consume(redisKey: string, token: string): Promise<boolean> {
  const redis = getRedis();
  const stored = await redis.get(redisKey);
  if (!stored || stored !== sha256Hex(token)) return false;
  await redis.del(redisKey); // single-use
  return true;
}

/** Issue (or overwrite) an invite token for an email. Returns the raw token. */
export function issueInviteToken(email: string): Promise<string> {
  return issue(inviteKey(email), ADMIN_INVITE_TTL_SEC);
}

export function consumeInviteToken(email: string, token: string): Promise<boolean> {
  return consume(inviteKey(email), token);
}

/** Issue (or overwrite) a password-reset token. Returns the raw token. */
export function issueResetToken(email: string): Promise<string> {
  return issue(resetKey(email), ADMIN_RESET_TTL_SEC);
}

export function consumeResetToken(email: string, token: string): Promise<boolean> {
  return consume(resetKey(email), token);
}

/**
 * Returns true when the per-email reset-request throttle is exceeded. Fails open
 * (returns false) if Redis is unavailable — same posture as the OTP throttle:
 * availability of sign-in beats a best-effort abuse guard.
 */
export async function resetRequestThrottled(email: string): Promise<boolean> {
  try {
    const redis = getRedis();
    const k = resetThrottleKey(email);
    const n = await redis.incr(k);
    if (n === 1) await redis.expire(k, RESET_THROTTLE_WINDOW_SEC);
    return n > RESET_THROTTLE_MAX;
  } catch (err) {
    logger.warn({ err }, "admin reset throttle unavailable; allowing");
    return false;
  }
}

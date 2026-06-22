import { randomInt } from "crypto";
import { getRedis } from "../lib/redis";
import { env } from "../env";

const KEY_PREFIX = "admin-otp:";
const ATTEMPT_KEY_PREFIX = "admin-otp-attempts:";
const BACKOFF_KEY_PREFIX = "admin-otp-backoff:";
const TTL_SEC = 300; // 5 minutes

/**
 * Backoff window after each consecutive wrong attempt (seconds):
 *   1st wrong  →  30 s
 *   2nd wrong  →  5 min
 *   3rd wrong  →  1 hr
 *   4th wrong  →  24 hr  (final lockout)
 */
const BACKOFF_SECONDS = [30, 300, 3_600, 86_400] as const;

export type OtpConsumeResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "backoff" | "locked"; retryAfter?: number };

/** Returns true if the email is in the configured admin allowlist. */
export function isAllowedAdminEmail(email: string): boolean {
  return env.ADMIN_EMAILS.includes(email.toLowerCase());
}

/** Generate and persist a 6-digit OTP for an admin email. Returns the code. */
export async function issueAdminOtp(email: string): Promise<string> {
  const code = String(randomInt(100000, 999999));
  const redis = getRedis();
  await redis.set(`${KEY_PREFIX}${email}`, code, "EX", TTL_SEC);
  // A fresh code request resets both the attempt counter and any active backoff.
  await redis.del(`${ATTEMPT_KEY_PREFIX}${email}`, `${BACKOFF_KEY_PREFIX}${email}`);
  return code;
}

/**
 * Verify and atomically consume the OTP.
 *
 * Returns `{ ok: true }` on success. On failure:
 * - `"invalid"` – wrong code; `retryAfter` is the new backoff window just imposed.
 * - `"backoff"` – still inside a backoff window; `retryAfter` is seconds remaining.
 * - `"locked"` – 24-hour final lockout; `retryAfter` is seconds remaining.
 *
 * An expired (or never-issued) OTP returns `"invalid"` without counting as an attempt.
 */
export async function consumeAdminOtp(email: string, code: string): Promise<OtpConsumeResult> {
  const redis = getRedis();
  const otpKey = `${KEY_PREFIX}${email}`;
  const attemptKey = `${ATTEMPT_KEY_PREFIX}${email}`;
  const backoffKey = `${BACKOFF_KEY_PREFIX}${email}`;

  // Check for an active backoff window before touching the code.
  const [backoffReason, backoffTtl] = await Promise.all([
    redis.get(backoffKey),
    redis.ttl(backoffKey),
  ]);
  if (backoffReason !== null && backoffTtl > 0) {
    return { ok: false, reason: backoffReason as "backoff" | "locked", retryAfter: backoffTtl };
  }

  const stored = await redis.get(otpKey);

  // OTP expired (or never issued) — don't count against the attempt limit.
  if (!stored) return { ok: false, reason: "invalid" };

  if (stored !== code) {
    // Wrong code — apply the next backoff tier.
    const attempts = await redis.incr(attemptKey);
    const backoffSec = BACKOFF_SECONDS[attempts - 1] ?? BACKOFF_SECONDS[BACKOFF_SECONDS.length - 1];
    const isLocked = attempts >= BACKOFF_SECONDS.length;

    await redis.set(backoffKey, isLocked ? "locked" : "backoff", "EX", backoffSec);
    await redis.expire(attemptKey, backoffSec + 60);

    return { ok: false, reason: isLocked ? "locked" : "invalid", retryAfter: backoffSec };
  }

  // Correct code — consume atomically.
  await redis.del(otpKey, attemptKey, backoffKey);
  return { ok: true };
}

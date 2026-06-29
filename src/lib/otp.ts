import { createHash, randomInt } from "node:crypto";
import { getRedis } from "./redis";
import { logger } from "./logger";
import { env } from "../env";

/** Wrong-attempt backoff ladder (seconds): 30s -> 5m -> 1h -> 24h lockout. */
const BACKOFF_SECONDS = [30, 300, 3_600, 86_400] as const;

export type OtpConsumeResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "backoff" | "locked"; retryAfter?: number };

export interface OtpConfig {
  /** Redis key namespace, e.g. "auth-otp" / "admin-otp". */
  namespace: string;
  /** Code lifetime in seconds. */
  ttlSec: number;
  /** Optional per-identifier issue throttle. */
  throttle?: { max: number; windowSec: number };
}

export interface Otp {
  /**
   * Generate + store a hashed 6-digit code. Returns the plaintext to deliver,
   * or null if the issue throttle is exceeded (caller stays silent - no
   * enumeration). Does NOT reset an active lockout: a new code can't be used to
   * escape backoff.
   */
  issue(identifier: string): Promise<string | null>;
  /** Verify + atomically consume a code, applying the backoff ladder on misses. */
  consume(identifier: string, code: string): Promise<OtpConsumeResult>;
}

// Atomic check-and-consume so the GET (compare) and INCR (attempt count) can't
// interleave between concurrent guesses - the gap a per-key TOCTOU would leave.
const CONSUME_SCRIPT = `
local backoffReason = redis.call("GET", KEYS[3])
if backoffReason then
  local backoffTtl = redis.call("TTL", KEYS[3])
  if backoffTtl > 0 then
    return {backoffReason, backoffTtl}
  end
end

local stored = redis.call("GET", KEYS[1])
if not stored then
  return {"invalid", 0}
end

if stored ~= ARGV[1] then
  local attempts = redis.call("INCR", KEYS[2])
  local backoffSec = tonumber(ARGV[2])
  if attempts == 2 then
    backoffSec = tonumber(ARGV[3])
  elseif attempts == 3 then
    backoffSec = tonumber(ARGV[4])
  elseif attempts >= 4 then
    backoffSec = tonumber(ARGV[5])
  end

  local reason = "backoff"
  local responseReason = "invalid"
  if attempts >= 4 then
    reason = "locked"
    responseReason = "locked"
  end

  redis.call("SET", KEYS[3], reason, "EX", backoffSec)
  redis.call("EXPIRE", KEYS[2], backoffSec + 60)
  return {responseReason, backoffSec}
end

redis.call("DEL", KEYS[1], KEYS[2], KEYS[3])
return {"ok", 0}
`;

/**
 * Codes are stored hashed (never plaintext), bound to the identifier + AUTH_SECRET.
 * The namespace is NOT part of the hash — it already scopes the Redis key, so
 * adding it here would be redundant and break compatibility with stored codes.
 */
function hashCode(identifier: string, code: string): string {
  return createHash("sha256").update(`${identifier}:${code}:${env.AUTH_SECRET}`).digest("hex");
}

/**
 * One hardened OTP implementation, parameterized by namespace/TTL. Both the
 * user sign-in flow and the admin staff flow consume it so there's a single
 * place to keep hashing, atomic consume, and lockout correct.
 */
export function createOtp(config: OtpConfig): Otp {
  const codeKey = (id: string) => `${config.namespace}:${id}`;
  const attemptsKey = (id: string) => `${config.namespace}-attempts:${id}`;
  const backoffKey = (id: string) => `${config.namespace}-backoff:${id}`;
  const requestKey = (id: string) => `${config.namespace}-req:${id}`;

  async function throttleExceeded(identifier: string): Promise<boolean> {
    if (!config.throttle) return false;
    try {
      const redis = getRedis();
      const n = await redis.incr(requestKey(identifier));
      if (n === 1) await redis.expire(requestKey(identifier), config.throttle.windowSec);
      return n > config.throttle.max;
    } catch (err) {
      logger.warn({ err, namespace: config.namespace }, "otp issue throttle unavailable; allowing");
      return false;
    }
  }

  return {
    async issue(identifier) {
      if (await throttleExceeded(identifier)) return null;
      const code = String(randomInt(100000, 999999));
      const redis = getRedis();
      await redis.set(codeKey(identifier), hashCode(identifier, code), "EX", config.ttlSec);
      return code;
    },

    async consume(identifier, code) {
      const redis = getRedis();
      const result = (await redis.eval(
        CONSUME_SCRIPT,
        3,
        codeKey(identifier),
        attemptsKey(identifier),
        backoffKey(identifier),
        hashCode(identifier, code),
        String(BACKOFF_SECONDS[0]),
        String(BACKOFF_SECONDS[1]),
        String(BACKOFF_SECONDS[2]),
        String(BACKOFF_SECONDS[3])
      )) as [string, number | string];

      const reason = result[0];
      const retryAfter = Number(result[1]);
      if (reason === "ok") return { ok: true };
      if (reason === "backoff" || reason === "locked") return { ok: false, reason, retryAfter };
      return retryAfter > 0
        ? { ok: false, reason: "invalid", retryAfter }
        : { ok: false, reason: "invalid" };
    },
  };
}

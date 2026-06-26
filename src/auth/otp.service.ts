import { randomInt } from "node:crypto";
import { db } from "../../db";
import { env } from "../env";
import { getRedis } from "../lib/redis";
import { logger } from "../lib/logger";
import { authIdentityRepo } from "../repositories";
import { resolveUser } from "../services/identity.service";
import { sendAuthOtp } from "./emails";
import { sha256Hex } from "./crypto";
import {
  issueSession,
  principalOf,
  type IssuedTokens,
  type SessionContext,
} from "./session.service";

const KEY_PREFIX = "auth-otp:";
const ATTEMPT_KEY_PREFIX = "auth-otp-attempts:";
const BACKOFF_KEY_PREFIX = "auth-otp-backoff:";
export const AUTH_OTP_TTL_SEC = 300;

const EMAIL_MAX = 5;
const EMAIL_WINDOW_SEC = 15 * 60;
const BACKOFF_SECONDS = [30, 300, 3_600, 86_400] as const;

export type AuthOtpConsumeResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "backoff" | "locked"; retryAfter?: number };

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function codeHash(email: string, code: string): string {
  return sha256Hex(`${normalizeEmail(email)}:${code}:${env.AUTH_SECRET}`);
}

async function emailThrottleExceeded(email: string): Promise<boolean> {
  try {
    const redis = getRedis();
    const key = `otp:req:${normalizeEmail(email)}`;
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, EMAIL_WINDOW_SEC);
    return n > EMAIL_MAX;
  } catch (err) {
    logger.warn({ err }, "auth otp email throttle unavailable; allowing");
    return false;
  }
}

export async function issueAuthOtp(email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  if (await emailThrottleExceeded(normalized)) return;

  const code = String(randomInt(100000, 999999));
  const redis = getRedis();

  await redis.set(`${KEY_PREFIX}${normalized}`, codeHash(normalized, code), "EX", AUTH_OTP_TTL_SEC);
  await sendAuthOtp(normalized, code, "sign-in");
}

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

export async function consumeAuthOtp(email: string, code: string): Promise<AuthOtpConsumeResult> {
  const normalized = normalizeEmail(email);
  const redis = getRedis();
  const result = (await redis.eval(
    CONSUME_SCRIPT,
    3,
    `${KEY_PREFIX}${normalized}`,
    `${ATTEMPT_KEY_PREFIX}${normalized}`,
    `${BACKOFF_KEY_PREFIX}${normalized}`,
    codeHash(normalized, code),
    String(BACKOFF_SECONDS[0]),
    String(BACKOFF_SECONDS[1]),
    String(BACKOFF_SECONDS[2]),
    String(BACKOFF_SECONDS[3])
  )) as [string, number | string];

  const reason = result[0];
  const retryAfter = Number(result[1]);

  if (reason === "ok") return { ok: true };
  if (reason === "backoff" || reason === "locked") {
    return { ok: false, reason, retryAfter };
  }
  return retryAfter > 0
    ? { ok: false, reason: "invalid", retryAfter }
    : { ok: false, reason: "invalid" };
}

export async function verifyAuthOtp(
  email: string,
  code: string,
  ctx: SessionContext = {}
): Promise<{ result: AuthOtpConsumeResult; tokens?: IssuedTokens }> {
  const normalized = normalizeEmail(email);
  const result = await consumeAuthOtp(normalized, code);
  if (!result.ok) return { result };

  const tokens = await db.transaction(async (tx) => {
    const identity = await authIdentityRepo.upsertByEmail(
      { email: normalized, name: normalized.split("@")[0] ?? "Thrivo user", emailVerified: true },
      tx
    );
    await resolveUser(principalOf(identity), tx);
    return issueSession(principalOf(identity), ctx, tx);
  });

  return { result, tokens };
}

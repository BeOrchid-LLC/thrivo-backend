import { db } from "../../db";
import { newId } from "../lib/ids";
import { getRedis } from "../lib/redis";
import { logger } from "../lib/logger";
import { env } from "../env";
import { UnauthorizedError } from "../lib/errors";
import { authIdentityRepo, verificationRepo } from "../repositories";
import { sendAuthMagicLink, sendWelcomeEmail } from "./emails";
import { sha256Hex, randomToken } from "./crypto";
import {
  issueSession,
  principalOf,
  type IssuedTokens,
  type SessionContext,
} from "./session.service";
import { resolveUser } from "../services/identity.service";

const TTL_MIN = 15;
const IDENTIFIER_PREFIX = "magic-link:";

// Per-email throttle, independent of the per-IP authRateLimit: an attacker
// rotating IPs could otherwise bomb a single inbox. Fails open on a Redis outage
// (a limiter must never take sign-in down).
const EMAIL_MAX = 5;
const EMAIL_WINDOW_SEC = 15 * 60;

async function emailThrottleExceeded(email: string): Promise<boolean> {
  try {
    const redis = getRedis();
    const key = `ml:req:${email}`;
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, EMAIL_WINDOW_SEC);
    return n > EMAIL_MAX;
  } catch (err) {
    logger.warn({ err }, "magic-link email throttle unavailable; allowing");
    return false;
  }
}

/**
 * Issue a magic-link email for `email`. The raw token travels only in the email
 * (HTTPS callback URL); we persist just its SHA-256 hash. Behaviour is identical
 * whether or not the email already has an account — the account is created on
 * verify — so this never leaks account existence.
 */
export async function requestMagicLink(email: string): Promise<void> {
  if (await emailThrottleExceeded(email)) return;

  const token = randomToken();
  await verificationRepo.create({
    id: newId(),
    identifier: `${IDENTIFIER_PREFIX}${email}`,
    valueHash: sha256Hex(token),
    expiresAt: new Date(Date.now() + TTL_MIN * 60 * 1000),
  });

  // HTTPS CTA survives email click tracking; the callback verifies server-side
  // and redirects to thrivo://auth with issued tokens (same as Google OAuth).
  const ctaUrl = `${env.AUTH_BASE_URL}/api/v1/auth/magic-link/callback?token=${encodeURIComponent(token)}`;
  await sendAuthMagicLink(email, ctaUrl);
}

/**
 * Verify a magic-link token: atomically consume it (one-time-use), upsert the
 * auth identity as email-verified, and issue a session — all in one transaction
 * so a partial failure leaves no half-created identity. Throws 401 on an
 * unknown, expired, or already-used token.
 */
export async function verifyMagicLink(
  token: string,
  ctx: SessionContext = {}
): Promise<IssuedTokens> {
  const row = await verificationRepo.consumeValid(sha256Hex(token));
  if (!row || !row.identifier.startsWith(IDENTIFIER_PREFIX)) {
    throw new UnauthorizedError("This sign-in link is invalid or has expired");
  }
  const email = row.identifier.slice(IDENTIFIER_PREFIX.length);

  let created = false;
  let newUserId = "";
  const tokens = await db.transaction(async (tx) => {
    const identity = await authIdentityRepo.upsertByEmail(
      { email, name: email.split("@")[0] ?? "Thrivo user", emailVerified: true },
      tx
    );
    const resolved = await resolveUser(principalOf(identity), tx);
    created = resolved.created;
    newUserId = resolved.user.id;
    return issueSession(principalOf(identity), ctx, tx);
  });

  // Fired after commit, never inside the transaction — see identity.service.ts.
  if (created) await sendWelcomeEmail(email, newUserId);

  return tokens;
}

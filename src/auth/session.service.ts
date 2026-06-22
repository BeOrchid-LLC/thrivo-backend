import { createHash, randomBytes } from "node:crypto";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { newId } from "../lib/ids";
import { authIdentityRepo, sessionRepo } from "../repositories";
import type { AuthUserRow } from "../repositories/auth-identity.repository";
import { env } from "../env";
import { signAccessToken } from "./tokens";
import type { AuthPrincipal } from "./types";

export type IssuedTokens = {
  accessToken: string;
  refreshToken: string;
  /** Expiry of the refresh token; clients use it to schedule re-auth. */
  refreshExpiresAt: Date;
};

export type SessionContext = { ipAddress?: string | null; userAgent?: string | null };

const REFRESH_BYTES = 32;

/** Map our auth identity row to the provider-neutral principal (ADR-0019). */
export function principalOf(row: AuthUserRow): AuthPrincipal {
  return {
    subjectId: row.id,
    email: row.email,
    emailVerified: row.emailVerified,
    name: row.name ?? undefined,
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newRefreshToken(): string {
  return randomBytes(REFRESH_BYTES).toString("base64url");
}

function refreshExpiry(): Date {
  return new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Mint an access token + a fresh DB-backed refresh session for a principal.
 * Caller must have already upserted the auth identity (FK: `session.userId` →
 * `auth_user.id`), which `principal.subjectId` references.
 */
export async function issueSession(
  principal: AuthPrincipal,
  ctx: SessionContext = {},
  tx: Executor = db
): Promise<IssuedTokens> {
  const accessToken = await signAccessToken(principal);
  const refreshToken = newRefreshToken();
  const refreshExpiresAt = refreshExpiry();

  await sessionRepo.create(
    {
      id: newId(),
      userId: principal.subjectId,
      tokenHash: hashToken(refreshToken),
      expiresAt: refreshExpiresAt,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
    tx
  );

  return { accessToken, refreshToken, refreshExpiresAt };
}

/**
 * Rotate a refresh token: consume the old session (one-time-use) and issue a new
 * access + refresh pair. Returns `null` if the token is unknown, expired, or
 * already consumed (replay) — the caller maps that to 401. Rotation-on-use means
 * a stolen-then-used refresh token is invalidated the moment the legitimate
 * client next refreshes.
 */
export async function rotateSession(
  refreshToken: string,
  ctx: SessionContext = {},
  tx: Executor = db
): Promise<{ tokens: IssuedTokens; principal: AuthPrincipal } | null> {
  const row = await sessionRepo.consumeValid(hashToken(refreshToken), tx);
  if (!row) return null;

  const identity = await authIdentityRepo.findById(row.userId, tx);
  if (!identity) return null;

  const principal = principalOf(identity);
  const tokens = await issueSession(principal, ctx, tx);
  return { tokens, principal };
}

/** Revoke the session behind a refresh token (logout this device). */
export async function revokeSession(refreshToken: string, tx: Executor = db): Promise<void> {
  await sessionRepo.deleteByTokenHash(hashToken(refreshToken), tx);
}

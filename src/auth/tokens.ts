import { SignJWT, jwtVerify } from "jose";
import { env } from "../env";
import type { AuthPrincipal } from "./types";

/**
 * Stateless access token (JWT, HS256). Short-lived — authority for a request is
 * the signature + expiry, so `verifyRequest` never hits the DB on the hot path.
 * Revocation is handled at the refresh layer (DB-backed sessions), not here.
 *
 * Signed with the existing auth secret (`BETTER_AUTH_SECRET`) so no env change is
 * needed mid-migration; renamed to a neutral `AUTH_SECRET` when BetterAuth is
 * decommissioned (Phase 5).
 */
const secret = new TextEncoder().encode(env.BETTER_AUTH_SECRET);
const ISSUER = "thrivo";
const AUDIENCE = "thrivo-app";

/** Mint an access token for a verified principal. */
export async function signAccessToken(principal: AuthPrincipal): Promise<string> {
  return new SignJWT({ email: principal.email, ev: principal.emailVerified, name: principal.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(principal.subjectId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(env.ACCESS_TOKEN_TTL)
    .sign(secret);
}

/**
 * Verify an access token into a principal, or `null` for any failure (bad
 * signature, wrong issuer/audience, expired, malformed). Never throws — callers
 * treat `null` as unauthenticated.
 */
export async function verifyAccessToken(token: string): Promise<AuthPrincipal | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: ISSUER, audience: AUDIENCE });
    if (!payload.sub || typeof payload.email !== "string") return null;
    return {
      subjectId: payload.sub,
      email: payload.email,
      emailVerified: payload.ev === true,
      name: typeof payload.name === "string" ? payload.name : undefined,
    };
  } catch {
    return null;
  }
}

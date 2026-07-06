import { SignJWT, jwtVerify } from "jose";
import { env } from "../env";
import { logger } from "../lib/logger";

export type AdminClaims = {
  id: string;
  email: string;
  name: string | null;
  role: string;
};

const secret = new TextEncoder().encode(env.AUTH_SECRET);
const ISSUER = "thrivo-admin";
const AUDIENCE = "thrivo-admin-panel";

/** Name of the httpOnly session cookie sent to the admin browser. */
export const ADMIN_COOKIE = "admin_session";

/**
 * Cookie options shared by set and clear.
 *
 * Production admin auth depends on this exact browser storage shape:
 *   Secure + SameSite=None + Partitioned
 *
 * The admin SPA lives on admin.thrivo.fit and calls the API on api.thrivo.fit
 * with `credentials: "include"`. In production browsers, the session cookie was
 * not reliably stored/sent after OTP verification until the cookie was issued as
 * a partitioned, secure, SameSite=None cookie. Do not "simplify" this back to
 * SameSite=Strict/Lax or remove Partitioned unless the admin auth flow is moved
 * behind a same-origin BFF/proxy and verified in a real browser.
 *
 * Local/dev cannot use Partitioned without Secure, so non-production falls back
 * to SameSite=Lax and no partitioning. httpOnly keeps the token out of JS; the
 * Origin check on mutations (admin-origin middleware) is the CSRF backstop.
 */

const secure = env.NODE_ENV === "production";
const sameSite = secure ? ("none" as const) : ("lax" as const);

export const ADMIN_COOKIE_OPTS = {
  httpOnly: true,
  secure,
  sameSite,
  partitioned: secure,
  path: "/",
} as const;

/** Sign a short-lived admin session JWT. */
export async function signAdminSession(claims: AdminClaims): Promise<string> {
  return new SignJWT({ email: claims.email, name: claims.name, role: claims.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(env.ADMIN_SESSION_TTL)
    .sign(secret);
}

/** Verify an admin session JWT, returning claims or null on any failure. */
export async function verifyAdminSession(token: string): Promise<AdminClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: ISSUER, audience: AUDIENCE });
    if (!payload.sub || typeof payload.email !== "string" || typeof payload.role !== "string") {
      return null;
    }
    return {
      id: payload.sub,
      email: payload.email,
      name: typeof payload.name === "string" ? payload.name : null,
      role: payload.role,
    };
  } catch (err) {
    // jose folds every failure (bad signature, expired, iss/aud mismatch) into a
    // thrown error; logging the code here is what lets us tell those apart in
    // Coolify logs instead of only ever seeing "Session expired" at the client.
    // JWTExpired/JWTClaimValidationFailed also carry the decoded (but rejected)
    // payload — logging iat/exp against the server's own clock is what pins down
    // whether ADMIN_SESSION_TTL is being parsed the way we expect.
    const code = err && typeof err === "object" && "code" in err ? err.code : undefined;
    const payload =
      err && typeof err === "object" && "payload" in err
        ? (err as { payload?: { iat?: unknown; exp?: unknown } }).payload
        : undefined;
    logger.warn(
      {
        code,
        message: err instanceof Error ? err.message : String(err),
        iat: payload?.iat,
        exp: payload?.exp,
        nowSeconds: Math.floor(Date.now() / 1000),
        adminSessionTtl: env.ADMIN_SESSION_TTL,
      },
      "admin session verification failed"
    );
    return null;
  }
}

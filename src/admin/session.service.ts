import { SignJWT, jwtVerify } from "jose";
import { env } from "../env";

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
 * Cookie options shared by set and clear. The `path` is scoped to `/api/v1/admin`
 * so the cookie is only sent on admin requests, not all API calls.
 */
export const ADMIN_COOKIE_OPTS = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "Lax" as const,
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
  } catch {
    return null;
  }
}

import { verifyToken } from "@clerk/backend";
import { env } from "../env";
import type { AuthPrincipal } from "./types";

export type { AuthPrincipal } from "./types";

/** Read a `Bearer` access token (mobile) from the Authorization header. */
function bearerToken(headers: Headers): string | null {
  const h = headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7).trim() || null : null;
}

/** Read a session token from the `thrivo_access` cookie (web/admin). */
function accessCookie(headers: Headers): string | null {
  const cookie = headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === "thrivo_access") {
      return decodeURIComponent(part.slice(eq + 1).trim()) || null;
    }
  }
  return null;
}

/**
 * Resolve a request's session into a provider-neutral `AuthPrincipal`, or `null`
 * when unauthenticated. The single auth entry point the middleware/domain call —
 * they never reach into the token layer directly (ADR-0019). Verifies Clerk
 * session JWTs from the `Bearer` header (mobile) or `thrivo_access` cookie (web).
 */
export async function verifyRequest(headers: Headers): Promise<AuthPrincipal | null> {
  const token = bearerToken(headers) ?? accessCookie(headers);
  if (!token) return null;

  try {
    const payload = await verifyToken(token, { secretKey: env.CLERK_SECRET_KEY });
    return {
      subjectId: payload.sub,
      // Claims injected by the Clerk JWT template (email, email_verified, name).
      email: payload.email as string,
      emailVerified: (payload.email_verified as boolean) ?? true,
      name: payload.name as string | undefined,
    };
  } catch {
    return null;
  }
}

import { verifyAccessToken } from "./tokens";
import type { AuthPrincipal } from "./types";

export type { AuthPrincipal } from "./types";

/** Read a `Bearer` access token (mobile) from the Authorization header. */
function bearerToken(headers: Headers): string | null {
  const h = headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7).trim() || null : null;
}

/** Read our access token from the `thrivo_access` cookie (web/admin). */
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
 * they never reach into the token layer directly (ADR-0019). Verifies our
 * hand-rolled access token from the `Bearer` header (mobile) or `thrivo_access`
 * cookie (web/admin).
 */
export async function verifyRequest(headers: Headers): Promise<AuthPrincipal | null> {
  const token = bearerToken(headers) ?? accessCookie(headers);
  return token ? verifyAccessToken(token) : null;
}

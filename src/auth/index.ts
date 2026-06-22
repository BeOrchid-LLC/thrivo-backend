import { auth } from "./provider";
import { verifyAccessToken } from "./tokens";
import type { AuthPrincipal } from "./types";

export type { AuthPrincipal } from "./types";

/**
 * The BetterAuth HTTP handler — still mounted at `/api/v1/auth/**` during the
 * migration off BetterAuth. New flows (magic link, Google) land on their own
 * router and this is removed in Phase 5.
 */
export const authHandler = (request: Request): Promise<Response> => auth.handler(request);

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
 * they never import the underlying provider directly (ADR-0019).
 *
 * Migration dual-path: prefer our hand-rolled access token (Bearer or cookie);
 * fall back to a legacy BetterAuth session so in-flight sessions keep working
 * until cutover. The BetterAuth branch is deleted in Phase 5.
 */
export async function verifyRequest(headers: Headers): Promise<AuthPrincipal | null> {
  const token = bearerToken(headers) ?? accessCookie(headers);
  if (token) {
    const principal = await verifyAccessToken(token);
    if (principal) return principal;
  }

  const session = await auth.api.getSession({ headers });
  if (!session?.user) return null;
  return {
    subjectId: session.user.id,
    email: session.user.email,
    emailVerified: session.user.emailVerified,
    name: session.user.name ?? undefined,
  };
}

import { verifyToken } from "@clerk/backend";
import { env } from "../env";
import type { AuthPrincipal, AdminClerkPrincipal } from "./types";

export type { AuthPrincipal, AdminClerkPrincipal } from "./types";

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
 * Resolve a consumer request into an `AuthPrincipal` using the BeOrchid Consumer
 * Clerk app. Checks the `Bearer` header (mobile) then the `thrivo_access` cookie
 * (web). Returns null when unauthenticated. The ADR-0019 seam — middleware never
 * reaches into the token layer directly.
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

/**
 * Resolve an admin request into an `AdminClerkPrincipal` using the BeOrchid Admin
 * Clerk app. Only reads the `Bearer` header — the admin SPA sends tokens as Bearer,
 * not as a cookie. Returns null when unauthenticated or when the token was issued
 * by a different Clerk instance (e.g. a consumer token is silently rejected here).
 */
export async function verifyAdminClerkRequest(
  headers: Headers
): Promise<AdminClerkPrincipal | null> {
  const token = bearerToken(headers);
  if (!token) return null;

  try {
    const payload = await verifyToken(token, { secretKey: env.CLERK_ADMIN_SECRET_KEY });
    return {
      subjectId: payload.sub,
      email: payload.email as string,
      emailVerified: (payload.email_verified as boolean) ?? true,
      name: payload.name as string | undefined,
      // `role` is injected by the Admin Clerk JWT template from public_metadata.role.
      role: payload.role as string | undefined,
    };
  } catch {
    return null;
  }
}

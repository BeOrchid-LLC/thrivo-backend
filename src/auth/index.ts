import { auth } from "./provider";
import type { AuthPrincipal } from "./types";

export type { AuthPrincipal } from "./types";

/**
 * The BetterAuth HTTP handler. Mounted at `/api/v1/auth/**` (sign-up/in/out,
 * OAuth callbacks, OTP). The mount point is the only coupling the router has.
 */
export const authHandler = (request: Request): Promise<Response> => auth.handler(request);

/**
 * Resolve a request's session (cookie or bearer) into a provider-neutral
 * `AuthPrincipal`, or `null` when unauthenticated. The single auth entry point
 * the middleware/domain call — they never import `better-auth` directly.
 */
export async function verifyRequest(headers: Headers): Promise<AuthPrincipal | null> {
  const session = await auth.api.getSession({ headers });
  if (!session?.user) return null;
  return {
    subjectId: session.user.id,
    email: session.user.email,
    emailVerified: session.user.emailVerified,
    name: session.user.name ?? undefined,
  };
}

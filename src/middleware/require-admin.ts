import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { UnauthorizedError, ForbiddenError } from "../lib/errors";
import { verifyAdminSession, ADMIN_COOKIE } from "../admin/session.service";
import type { AdminRole } from "../admin/otp.service";
import type { AppEnv } from "../types/http";

/**
 * Capability ladder: a higher rank can do everything a lower rank can. Reads
 * are open to any authenticated admin session (`requireAdmin`); mutations gate
 * on a minimum rank via `requireAdminRole` — `support` for content/moderation,
 * `admin` for destructive or money-adjacent actions.
 */
const ROLE_RANK: Record<AdminRole, number> = { "read-only": 0, support: 1, admin: 2 };

function isAdminRole(role: string): role is AdminRole {
  return role === "admin" || role === "support" || role === "read-only";
}

/**
 * Gate admin routes: reads the httpOnly `admin_session` JWT cookie, verifies it,
 * and requires *some* valid admin role. Sets `c.var.adminUser` for downstream
 * handlers (and for `requireAdminRole`). Independent of the user-facing auth
 * stack (`src/auth/`) — the admin OTP flow issues this cookie directly.
 */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, ADMIN_COOKIE);
  if (!token) throw new UnauthorizedError("Authentication required");

  const claims = await verifyAdminSession(token);
  if (!claims) throw new UnauthorizedError("Session expired, please sign in again");
  if (!isAdminRole(claims.role)) throw new ForbiddenError("Admin access required");

  c.set("adminUser", claims);
  await next();
});

/**
 * Require at least `min` capability. Must run AFTER `requireAdmin` (reads the
 * `adminUser` it set). Server-side is the real boundary; the admin app also
 * hides actions a role can't perform, but that is UX only.
 */
export function requireAdminRole(min: AdminRole) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const admin = c.get("adminUser");
    if (!admin) throw new UnauthorizedError("Authentication required");
    const rank = isAdminRole(admin.role) ? ROLE_RANK[admin.role] : -1;
    if (rank < ROLE_RANK[min]) {
      throw new ForbiddenError("Insufficient admin privileges for this action");
    }
    await next();
  });
}

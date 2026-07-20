import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { UnauthorizedError, ForbiddenError } from "../lib/errors";
import { verifyAdminSession, ADMIN_COOKIE } from "../admin/session.service";
import { getAdminSnapshot, setAdminSnapshot } from "../admin/snapshot.service";
import { adminAccountRepo } from "../repositories";
import type { AdminRole } from "../admin/otp.service";
import type { AppEnv } from "../types/http";

/**
 * Capability ladder: a higher rank can do everything a lower rank can. Reads
 * are open to any authenticated admin session (`requireAdmin`); mutations gate
 * on a minimum rank via `requireAdminRole` — `support` for content/moderation,
 * `admin` for destructive or money-adjacent actions, `super-admin` for managing
 * other admins.
 */
const ROLE_RANK: Record<AdminRole, number> = {
  "read-only": 0,
  support: 1,
  admin: 2,
  "super-admin": 3,
};

function isAdminRole(role: string): role is AdminRole {
  return role === "super-admin" || role === "admin" || role === "support" || role === "read-only";
}

/**
 * Gate admin routes: reads the httpOnly `admin_session` JWT cookie and verifies
 * it (identity + integrity), then gates authorization on a Redis-cached admin
 * snapshot backed by the `admin_users` table. A cache miss is re-read from the
 * DB and repopulated; a `disabled`/removed account (whose snapshot was
 * invalidated on the mutating request) fails here on its next request — this is
 * how `disable`/role-change take effect immediately despite the stateless JWT.
 *
 * Keyed by email so legacy cookies (whose `sub` was the email, pre `admin_users`)
 * resolve the same way as new uuid-subject cookies.
 */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, ADMIN_COOKIE);
  if (!token) throw new UnauthorizedError("Authentication required");

  const claims = await verifyAdminSession(token);
  if (!claims) throw new UnauthorizedError("Session expired, please sign in again");

  const email = claims.email.toLowerCase();
  let snapshot = await getAdminSnapshot(email);
  if (!snapshot) {
    const row = await adminAccountRepo.findByEmail(email);
    if (!row || row.status !== "active" || !isAdminRole(row.role)) {
      throw new UnauthorizedError("Session expired, please sign in again");
    }
    snapshot = { id: row.id, email: row.email, name: row.name, role: row.role, status: "active" };
    await setAdminSnapshot(snapshot);
  }

  if (snapshot.status !== "active") {
    throw new UnauthorizedError("Session expired, please sign in again");
  }
  if (!isAdminRole(snapshot.role)) throw new ForbiddenError("Admin access required");

  c.set("adminUser", {
    id: snapshot.id,
    email: snapshot.email,
    name: snapshot.name,
    role: snapshot.role,
  });
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

/** Convenience gate for admin-management routes — only super-admins may manage admins. */
export const requireSuperAdmin = requireAdminRole("super-admin");

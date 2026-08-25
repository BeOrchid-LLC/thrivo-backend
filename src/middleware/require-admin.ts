import { createMiddleware } from "hono/factory";
import { UnauthorizedError, ForbiddenError } from "../lib/errors";
import { verifyAdminClerkRequest } from "../auth";
import { getAdminSnapshot, setAdminSnapshot } from "../admin/snapshot.service";
import { adminAccountRepo } from "../repositories";
import type { AdminRole } from "../admin/otp.service";
import type { AdminPermission } from "../../contracts/src/admin-management";
import { effectivePermissions } from "../admin/permissions";
import type { AppEnv } from "../types/http";

/** Legacy role ladder retained for compatibility with routes that have not yet
 * moved to a concrete permission. New sensitive routes should use
 * `requireAdminPermission` so custom grants are enforced server-side. */
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
 * Gate admin routes via the BeOrchid Admin Clerk app. Verifies the Bearer JWT
 * issued by the Admin Clerk instance, then resolves the caller's admin_users
 * row via a Redis-cached snapshot. Cache is keyed by email (stable unique key
 * shared with the snapshot invalidation paths). On a cache miss the row is
 * re-read from the DB: first by clerkAdminId (populated after first webhook
 * fires), then by email as a fallback for the first sign-in before the webhook
 * has a chance to link the account.
 */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const principal = await verifyAdminClerkRequest(c.req.raw.headers);
  if (!principal) throw new UnauthorizedError("Authentication required");

  const email = principal.email.toLowerCase();
  let snapshot = await getAdminSnapshot(email);
  if (!snapshot) {
    let row = await adminAccountRepo.findByClerkAdminId(principal.subjectId);
    if (!row) row = await adminAccountRepo.findByEmail(email);
    if (!row || row.status !== "active" || !isAdminRole(row.role)) {
      throw new UnauthorizedError("Authentication required");
    }
    snapshot = { id: row.id, email: row.email, name: row.name, role: row.role, status: "active" };
    await setAdminSnapshot(snapshot);
  }

  if (snapshot.status !== "active") {
    throw new UnauthorizedError("Authentication required");
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

/** Require a concrete capability from the caller's role defaults or overrides. */
export function requireAdminPermission(permission: AdminPermission) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const admin = c.get("adminUser");
    if (!admin) throw new UnauthorizedError("Authentication required");
    const row = await adminAccountRepo.findByEmail(admin.email);
    if (
      !row ||
      !isAdminRole(row.role) ||
      !effectivePermissions(row.role as AdminRole, row.permissions).includes(permission)
    ) {
      throw new ForbiddenError("Insufficient admin permissions for this action");
    }
    await next();
  });
}

/** Compatibility gate for legacy callers; admin management now uses the
 * `admins.manage` permission so a scoped custom grant can be honored. */
export const requireSuperAdmin = requireAdminRole("super-admin");

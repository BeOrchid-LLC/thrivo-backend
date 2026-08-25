import type { AdminPermission } from "../../contracts/src/admin-management";
import type { AdminRole } from "./otp.service";

export const ROLE_DEFAULT_PERMISSIONS: Record<AdminRole, readonly AdminPermission[]> = {
  "read-only": ["users.read", "subscriptions.read", "billing.read", "audit.read", "analytics.read"],
  support: [
    "users.read",
    "subscriptions.read",
    "billing.read",
    "audit.read",
    "analytics.read",
    "content.manage",
    "moderation.manage",
    "foods.manage",
    "push.manage",
  ],
  admin: [
    "users.read",
    "users.manage",
    "subscriptions.read",
    "subscriptions.manage",
    "billing.read",
    "billing.manage",
    "content.manage",
    "moderation.manage",
    "foods.manage",
    "push.manage",
    "erasures.manage",
    "leads.manage",
    "audit.read",
    "analytics.read",
    "settings.manage",
  ],
  "super-admin": [
    "users.read",
    "users.manage",
    "subscriptions.read",
    "subscriptions.manage",
    "billing.read",
    "billing.manage",
    "content.manage",
    "moderation.manage",
    "foods.manage",
    "push.manage",
    "erasures.manage",
    "leads.manage",
    "audit.read",
    "analytics.read",
    "admins.manage",
    "settings.manage",
  ],
};

export function permissionsForRole(role: AdminRole): AdminPermission[] {
  return [...ROLE_DEFAULT_PERMISSIONS[role]];
}

export function effectivePermissions(
  role: AdminRole,
  explicit: readonly string[] | null | undefined
): AdminPermission[] {
  if (!explicit) return permissionsForRole(role);
  const allowed = new Set(ROLE_DEFAULT_PERMISSIONS["super-admin"]);
  return explicit.filter((value): value is AdminPermission =>
    allowed.has(value as AdminPermission)
  );
}

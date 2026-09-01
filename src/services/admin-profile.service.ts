import { UnauthorizedError } from "../lib/errors";
import { adminAccountRepo } from "../repositories";
import type { AdminAccount } from "../repositories/admin-account.repository";
import type { AdminRole } from "../admin/otp.service";
import { effectivePermissions } from "../admin/permissions";
import { adminPermissionSchema, type AdminPermission } from "../../contracts/src/admin-management";
import type { AdminClaims } from "../admin/session.service";

function isAdminRole(role: string): role is AdminRole {
  return role === "super-admin" || role === "admin" || role === "support" || role === "read-only";
}

function normalizedPermissions(value: unknown): AdminPermission[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter(
    (permission): permission is AdminPermission =>
      adminPermissionSchema.safeParse(permission).success
  );
}

/** Serialize the authoritative self-profile without exposing auth internals. */
export function toAdminSelfProfileDto(row: AdminAccount) {
  if (!isAdminRole(row.role)) throw new UnauthorizedError("Admin access required");

  const permissions = normalizedPermissions(row.permissions);
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    permissions,
    effectivePermissions: effectivePermissions(row.role, permissions),
    permissionSource:
      permissions === null && row.permissions == null ? ("role" as const) : ("custom" as const),
    invitedByEmail: row.invitedByEmail,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    inviteExpiresAt: row.inviteExpiresAt?.toISOString() ?? null,
    inviteRevokedAt: row.inviteRevokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    authProvider: "clerk" as const,
  };
}

/** Read the current DB row, rather than the potentially stale session snapshot. */
export async function getAdminSelfProfile(admin: Pick<AdminClaims, "id" | "email">) {
  const row = await adminAccountRepo.findById(admin.id);
  if (!row || row.status !== "active" || row.email.toLowerCase() !== admin.email.toLowerCase()) {
    throw new UnauthorizedError("Authentication required");
  }
  return row;
}

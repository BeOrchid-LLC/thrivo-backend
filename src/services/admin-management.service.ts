import { createClerkClient } from "@clerk/backend";
import { ConflictError, ForbiddenError, NotFoundError } from "../lib/errors";
import { adminAccountRepo, adminAuditLogRepo } from "../repositories";
import type { AdminAccount, AdminAccountStatus } from "../repositories/admin-account.repository";
import type { AuditActor } from "../repositories/admin-audit-log.repository";
import type { AdminRole } from "../admin/otp.service";
import { invalidateAdminSnapshot } from "../admin/snapshot.service";
import { ADMIN_INVITE_TTL_SEC } from "../admin/token.service";
import { env } from "../env";
import { db } from "../../db";
import { effectivePermissions } from "../admin/permissions";
import type { AdminPermission } from "../../contracts/src/admin-management";

/** Serialize an admin row into the `adminAccountSchema` contract shape. */
export function toAdminAccountDto(row: AdminAccount) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as AdminRole,
    status: row.status as AdminAccountStatus,
    permissions: (row.permissions ?? null) as string[] | null,
    invitedByEmail: row.invitedByEmail,
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    inviteExpiresAt: row.inviteExpiresAt ? row.inviteExpiresAt.toISOString() : null,
    inviteRevokedAt: row.inviteRevokedAt ? row.inviteRevokedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

const clerk = createClerkClient({ secretKey: env.CLERK_ADMIN_SECRET_KEY });

async function createInvitation(email: string, role: AdminRole) {
  return clerk.invitations.createInvitation({
    emailAddress: email,
    expiresInDays: ADMIN_INVITE_TTL_SEC / (24 * 60 * 60),
    publicMetadata: { role, permissions: null },
    redirectUrl: `${env.ADMIN_APP_URL}/accept-invite`,
    notify: true,
    ignoreExisting: true,
  });
}

async function syncClerkAdminMetadata(
  clerkAdminId: string,
  role: AdminRole,
  permissions: string[] | null
): Promise<void> {
  await clerk.users.updateUserMetadata(clerkAdminId, {
    publicMetadata: { role, permissions },
  });
}

export async function listAdmins(): Promise<AdminAccount[]> {
  return adminAccountRepo.listAll();
}

/** Invite a new admin — creates a Clerk invitation and an `invited` audit row. */
export async function inviteAdmin(
  input: { email: string; name: string; role: AdminRole },
  actor: AuditActor
): Promise<AdminAccount> {
  const email = input.email.toLowerCase();
  const existing = await adminAccountRepo.findByEmail(email);
  if (existing) throw new ConflictError("An admin with this email already exists");
  const actorRow = await adminAccountRepo.findByEmail(actor.actorAdminEmail);
  if (!actorRow || (input.role === "super-admin" && actorRow.role !== "super-admin")) {
    throw new ForbiddenError("Only a super-admin can invite another super-admin");
  }

  const invitation = await createInvitation(email, input.role);
  try {
    return await db.transaction(async (tx) => {
      const row = await adminAccountRepo.insertInvited(
        {
          email,
          name: input.name,
          role: input.role,
          invitedByEmail: actor.actorAdminEmail,
        },
        tx
      );
      await adminAccountRepo.update(
        row.id,
        {
          clerkInvitationId: invitation.id,
          inviteExpiresAt: new Date(Date.now() + ADMIN_INVITE_TTL_SEC * 1000),
        },
        tx
      );
      await adminAuditLogRepo.append(
        {
          actorAdminEmail: actor.actorAdminEmail,
          action: "admin.invite",
          targetType: "admin",
          targetId: row.id,
          after: { email: row.email, role: row.role },
          requestId: actor.requestId,
          ip: actor.ip,
        },
        tx
      );
      return (await adminAccountRepo.findById(row.id, tx)) as AdminAccount;
    });
  } catch (error) {
    await clerk.invitations.revokeInvitation(invitation.id).catch(() => undefined);
    throw error;
  }
}

/** Patch name/role/status, guarding against super-admin lockout. */
export async function updateAdmin(
  id: string,
  patch: {
    name?: string;
    role?: AdminRole;
    status?: AdminAccountStatus;
    permissions?: AdminPermission[] | null;
  },
  actor: AuditActor
): Promise<AdminAccount> {
  const target = await adminAccountRepo.findById(id);
  if (!target) throw new NotFoundError("Admin not found");

  if (patch.status === "invited" || patch.status === "revoked") {
    throw new ConflictError("Use the dedicated invitation lifecycle endpoint");
  }
  if (patch.status === "active" && target.status !== "active" && target.status !== "disabled") {
    throw new ConflictError("Only disabled accounts can be re-enabled");
  }
  if (patch.status === "disabled" && target.status !== "active" && target.status !== "disabled") {
    throw new ConflictError("Only active accounts can be disabled; revoke pending invites");
  }

  const disabling = patch.status === "disabled";
  const demoting =
    patch.role !== undefined && patch.role !== "super-admin" && target.role === "super-admin";
  const isSelf = target.email.toLowerCase() === actor.actorAdminEmail.toLowerCase();
  const actorRow = await adminAccountRepo.findByEmail(actor.actorAdminEmail);
  if (!actorRow) throw new ForbiddenError("Admin account is not available");
  const actorPermissions = effectivePermissions(actorRow.role as AdminRole, actorRow.permissions);

  if (patch.permissions !== undefined && patch.permissions !== null) {
    const actorSet = new Set(actorPermissions);
    if (patch.permissions.some((permission) => !actorSet.has(permission))) {
      throw new ForbiddenError("You cannot grant permissions you do not possess");
    }
  }

  if (isSelf && (disabling || demoting)) {
    throw new ForbiddenError("You cannot disable or demote your own account");
  }
  // Never allow the last active super-admin to be removed from the role.
  if (target.role === "super-admin" && target.status === "active" && (disabling || demoting)) {
    const remaining = await adminAccountRepo.countActiveSuperAdmins(target.id);
    if (remaining === 0) {
      throw new ForbiddenError("At least one active super admin is required");
    }
  }
  if (
    target.role === "super-admin" &&
    target.status === "active" &&
    patch.permissions !== undefined &&
    (patch.permissions === null ||
      !patch.permissions.includes("admins.manage") ||
      !patch.permissions.includes("settings.manage"))
  ) {
    const remaining = await adminAccountRepo.countActiveSuperAdmins(target.id);
    if (remaining === 0) {
      throw new ForbiddenError("The last active super-admin must retain recovery permissions");
    }
  }

  const before = {
    name: target.name,
    role: target.role,
    status: target.status,
    permissions: target.permissions,
  };
  const nextRole = patch.role ?? (target.role as AdminRole);
  const nextPermissions =
    patch.permissions !== undefined ? patch.permissions : (target.permissions as string[] | null);
  const shouldSyncClerk =
    Boolean(target.clerkAdminId) &&
    (patch.role !== undefined || patch.permissions !== undefined) &&
    (nextRole !== target.role || nextPermissions !== target.permissions);

  if (shouldSyncClerk) {
    await syncClerkAdminMetadata(target.clerkAdminId!, nextRole, nextPermissions);
  }

  let updated: AdminAccount;
  try {
    updated = await db.transaction(async (tx) => {
      const row = await adminAccountRepo.update(id, patch, tx);
      await adminAuditLogRepo.append(
        {
          actorAdminEmail: actor.actorAdminEmail,
          action:
            patch.status === "disabled"
              ? "admin.disable"
              : patch.status === "active" && target.status === "disabled"
                ? "admin.enable"
                : patch.permissions !== undefined
                  ? "admin.permissions_change"
                  : patch.role !== undefined
                    ? "admin.role_change"
                    : "admin.update",
          targetType: "admin",
          targetId: id,
          before,
          after: {
            name: row.name,
            role: row.role,
            status: row.status,
            permissions: row.permissions,
          },
          requestId: actor.requestId,
          ip: actor.ip,
        },
        tx
      );
      return row;
    });
  } catch (error) {
    if (shouldSyncClerk) {
      try {
        await syncClerkAdminMetadata(
          target.clerkAdminId!,
          target.role as AdminRole,
          target.permissions as string[] | null
        );
      } catch {
        // Preserve the original database error; an operator can reconcile the
        // Clerk metadata from the audit row if the compensating call fails.
      }
    }
    throw error;
  }

  // Role/status changes must take effect immediately — drop the cached snapshot.
  if (patch.role !== undefined || patch.status !== undefined) {
    await invalidateAdminSnapshot(target.email);
  }

  return updated;
}

/** Re-send an invite to a still-pending admin (fresh token, overwrites the old). */
export async function resendInvite(id: string, actor: AuditActor): Promise<AdminAccount> {
  const target = await adminAccountRepo.findById(id);
  if (!target) throw new NotFoundError("Admin not found");
  if (target.status !== "invited" && target.status !== "revoked") {
    throw new ConflictError("This admin has already accepted their invite");
  }
  if (target.clerkInvitationId) {
    await clerk.invitations.revokeInvitation(target.clerkInvitationId);
  }
  const invitation = await createInvitation(target.email, target.role as AdminRole);
  try {
    return await db.transaction(async (tx) => {
      const row = await adminAccountRepo.update(
        id,
        {
          status: "invited",
          inviteRevokedAt: null,
          clerkInvitationId: invitation.id,
          inviteExpiresAt: new Date(Date.now() + ADMIN_INVITE_TTL_SEC * 1000),
        },
        tx
      );
      await adminAuditLogRepo.append(
        {
          actorAdminEmail: actor.actorAdminEmail,
          action: "admin.invite_resend",
          targetType: "admin",
          targetId: id,
          requestId: actor.requestId,
          ip: actor.ip,
        },
        tx
      );
      return row;
    });
  } catch (error) {
    await clerk.invitations.revokeInvitation(invitation.id).catch(() => undefined);
    throw error;
  }
}

export async function revokeInvite(id: string, actor: AuditActor): Promise<AdminAccount> {
  const target = await adminAccountRepo.findById(id);
  if (!target) throw new NotFoundError("Admin not found");
  if (target.status !== "invited") throw new ConflictError("Only pending invites can be revoked");
  if (target.clerkInvitationId) {
    await clerk.invitations.revokeInvitation(target.clerkInvitationId);
  }
  return db.transaction(async (tx) => {
    const updated = await adminAccountRepo.update(
      id,
      {
        status: "revoked",
        inviteRevokedAt: new Date(),
      },
      tx
    );
    await adminAuditLogRepo.append(
      {
        actorAdminEmail: actor.actorAdminEmail,
        action: "admin.invite_revoke",
        targetType: "admin",
        targetId: id,
        before: { status: target.status },
        after: { status: updated.status },
        requestId: actor.requestId,
        ip: actor.ip,
      },
      tx
    );
    return updated;
  });
}

/** Soft-disable (DELETE) — reuses updateAdmin so the lockout guards apply. */
export async function disableAdmin(id: string, actor: AuditActor): Promise<AdminAccount> {
  return updateAdmin(id, { status: "disabled" }, actor);
}

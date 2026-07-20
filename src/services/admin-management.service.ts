import { ConflictError, ForbiddenError, NotFoundError } from "../lib/errors";
import { adminAccountRepo, adminAuditLogRepo } from "../repositories";
import type { AdminAccount, AdminAccountStatus } from "../repositories/admin-account.repository";
import type { AuditActor } from "../repositories/admin-audit-log.repository";
import type { AdminRole } from "../admin/otp.service";
import { invalidateAdminSnapshot } from "../admin/snapshot.service";
import { issueInviteToken, adminInviteLink, ADMIN_INVITE_TTL_SEC } from "../admin/token.service";
import { sendTemplatedEmail } from "./email.service";

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
    createdAt: row.createdAt.toISOString(),
  };
}

async function sendInviteEmail(row: AdminAccount): Promise<void> {
  const token = await issueInviteToken(row.email);
  await sendTemplatedEmail({
    to: row.email,
    template: "admin-invite",
    props: {
      url: adminInviteLink(row.email, token),
      role: row.role,
      invitedByEmail: row.invitedByEmail,
      expiresInHours: Math.round(ADMIN_INVITE_TTL_SEC / 3600),
    },
  });
}

export async function listAdmins(): Promise<AdminAccount[]> {
  return adminAccountRepo.listAll();
}

/** Invite a new admin — creates an `invited` row and emails a set-password link. */
export async function inviteAdmin(
  input: { email: string; name: string; role: AdminRole },
  actor: AuditActor
): Promise<AdminAccount> {
  const email = input.email.toLowerCase();
  const existing = await adminAccountRepo.findByEmail(email);
  if (existing) throw new ConflictError("An admin with this email already exists");

  const row = await adminAccountRepo.insertInvited({
    email,
    name: input.name,
    role: input.role,
    invitedByEmail: actor.actorAdminEmail,
  });
  await sendInviteEmail(row);
  await adminAuditLogRepo.append({
    actorAdminEmail: actor.actorAdminEmail,
    action: "admin.invite",
    targetType: "admin",
    targetId: row.id,
    after: { email: row.email, role: row.role },
    requestId: actor.requestId,
    ip: actor.ip,
  });
  return row;
}

/** Patch name/role/status, guarding against super-admin lockout. */
export async function updateAdmin(
  id: string,
  patch: { name?: string; role?: AdminRole; status?: AdminAccountStatus },
  actor: AuditActor
): Promise<AdminAccount> {
  const target = await adminAccountRepo.findById(id);
  if (!target) throw new NotFoundError("Admin not found");

  const disabling = patch.status === "disabled";
  const demoting =
    patch.role !== undefined && patch.role !== "super-admin" && target.role === "super-admin";
  const isSelf = target.email.toLowerCase() === actor.actorAdminEmail.toLowerCase();

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

  const before = { name: target.name, role: target.role, status: target.status };
  const updated = await adminAccountRepo.update(id, patch);

  // Role/status changes must take effect immediately — drop the cached snapshot.
  if (patch.role !== undefined || patch.status !== undefined) {
    await invalidateAdminSnapshot(target.email);
  }

  const action =
    patch.status === "disabled"
      ? "admin.disable"
      : patch.role !== undefined
        ? "admin.role_change"
        : "admin.update";
  await adminAuditLogRepo.append({
    actorAdminEmail: actor.actorAdminEmail,
    action,
    targetType: "admin",
    targetId: id,
    before,
    after: { name: updated.name, role: updated.role, status: updated.status },
    requestId: actor.requestId,
    ip: actor.ip,
  });
  return updated;
}

/** Re-send an invite to a still-pending admin (fresh token, overwrites the old). */
export async function resendInvite(id: string, actor: AuditActor): Promise<AdminAccount> {
  const target = await adminAccountRepo.findById(id);
  if (!target) throw new NotFoundError("Admin not found");
  if (target.status !== "invited") {
    throw new ConflictError("This admin has already accepted their invite");
  }
  await sendInviteEmail(target);
  await adminAuditLogRepo.append({
    actorAdminEmail: actor.actorAdminEmail,
    action: "admin.reinvite",
    targetType: "admin",
    targetId: id,
    requestId: actor.requestId,
    ip: actor.ip,
  });
  return target;
}

/** Soft-disable (DELETE) — reuses updateAdmin so the lockout guards apply. */
export async function disableAdmin(id: string, actor: AuditActor): Promise<AdminAccount> {
  return updateAdmin(id, { status: "disabled" }, actor);
}

import type { Context } from "hono";
import {
  adminInvitePayloadSchema,
  adminUpdatePayloadSchema,
} from "../../contracts/src/admin-management";
import { respondOk } from "../lib/response";
import { getClientIp } from "../lib/request-ip";
import { getValidatedInput } from "../middleware/validate";
import {
  listAdmins,
  inviteAdmin,
  updateAdmin,
  resendInvite,
  revokeInvite,
  disableAdmin,
  toAdminAccountDto,
} from "../services/admin-management.service";
import type { AuditActor } from "../repositories/admin-audit-log.repository";
import type { AppEnv } from "../types/http";

function auditActor(c: Context<AppEnv>): AuditActor {
  const admin = c.get("adminUser")!;
  return {
    actorAdminEmail: admin.email,
    requestId: c.get("requestId") ?? null,
    ip: getClientIp(c),
  };
}

/** GET /admin/admins — list every admin account. */
export async function listAdminAccounts(c: Context<AppEnv>) {
  const rows = await listAdmins();
  return respondOk(c, { items: rows.map(toAdminAccountDto) });
}

/** POST /admin/admins/invite — invite a new admin. */
export async function inviteAdminAccount(c: Context<AppEnv>) {
  const input = adminInvitePayloadSchema.parse(getValidatedInput(c, "json"));
  const row = await inviteAdmin(input, auditActor(c));
  return respondOk(c, { admin: toAdminAccountDto(row) }, "Invitation sent", 201);
}

/** PATCH /admin/admins/:id — update name/role/status. */
export async function updateAdminAccount(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const patch = adminUpdatePayloadSchema.parse(getValidatedInput(c, "json"));
  const row = await updateAdmin(id, patch, auditActor(c));
  return respondOk(c, { admin: toAdminAccountDto(row) }, "Admin updated");
}

/** POST /admin/admins/:id/resend-invite — re-send a pending invite. */
export async function resendAdminInvite(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const row = await resendInvite(id, auditActor(c));
  return respondOk(c, { admin: toAdminAccountDto(row) }, "Invitation re-sent");
}

/** POST /admin/admins/:id/revoke-invite — revoke a pending invitation. */
export async function revokeAdminInvite(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const row = await revokeInvite(id, auditActor(c));
  return respondOk(c, { admin: toAdminAccountDto(row) }, "Invitation revoked");
}

/** DELETE /admin/admins/:id — soft-disable. */
export async function disableAdminAccount(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const row = await disableAdmin(id, auditActor(c));
  return respondOk(c, { admin: toAdminAccountDto(row) }, "Admin disabled");
}

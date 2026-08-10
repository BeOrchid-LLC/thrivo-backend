import type { Context } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import {
  adminPasswordLoginPayloadSchema,
  adminAcceptInvitePayloadSchema,
  adminRequestPasswordResetPayloadSchema,
  adminResetPasswordPayloadSchema,
  adminChangePasswordPayloadSchema,
} from "../../contracts/src/admin";
import { respondOk } from "../lib/response";
import { getClientIp } from "../lib/request-ip";
import { ForbiddenError, UnauthorizedError, ValidationError } from "../lib/errors";
import { issueAdminOtp, consumeAdminOtp, ADMIN_OTP_TTL_SEC } from "../admin/otp.service";
import type { AdminRole } from "../admin/otp.service";
import {
  signAdminSession,
  ADMIN_COOKIE,
  ADMIN_COOKIE_OPTS,
  LEGACY_ADMIN_COOKIE_OPTS,
} from "../admin/session.service";
import { setAdminSnapshot, invalidateAdminSnapshot } from "../admin/snapshot.service";
import {
  consumeInviteToken,
  issueResetToken,
  consumeResetToken,
  resetRequestThrottled,
  adminResetLink,
  ADMIN_RESET_TTL_SEC,
} from "../admin/token.service";
import { hashPassword, verifyPassword } from "../admin/password";
import { adminAccountRepo, adminAuditLogRepo } from "../repositories";
import type { AdminAccount } from "../repositories/admin-account.repository";
import { queueTemplatedEmail } from "../services/email.service";
import type { AppEnv } from "../types/http";
import { db } from "../../db";
import type { Executor } from "../../db/tx";

const emailSchema = z
  .string()
  .email()
  .transform((e) => e.toLowerCase());

const requestOtpSchema = z.object({ email: emailSchema });
const verifyOtpSchema = z.object({ email: emailSchema, code: z.string().min(4).max(8) });

/** Public identity view returned to the client after any successful auth. */
function toAdminView(a: AdminAccount) {
  return { id: a.id, email: a.email, name: a.name, role: a.role };
}

/**
 * Issue the session cookie + prime the revocation snapshot for a freshly
 * authenticated admin. Shared by password login, OTP verify, accept-invite and
 * password reset so the cookie/snapshot handling can't drift between them.
 */
async function establishSession(c: Context<AppEnv>, account: AdminAccount): Promise<void> {
  const token = await signAdminSession({
    id: account.id,
    email: account.email,
    name: account.name,
    role: account.role,
  });
  setCookie(c, ADMIN_COOKIE, token, ADMIN_COOKIE_OPTS);
  // Evict any stale pre-Partitioned cookie (see LEGACY_ADMIN_COOKIE_OPTS).
  deleteCookie(c, ADMIN_COOKIE, LEGACY_ADMIN_COOKIE_OPTS);
  await setAdminSnapshot({
    id: account.id,
    email: account.email,
    name: account.name,
    role: account.role as AdminRole,
    status: "active",
  });
}

/** Append an admin-auth audit row. Actor is the authenticating email itself. */
async function auditAuth(
  c: Context<AppEnv>,
  email: string,
  action: string,
  transaction?: Executor
): Promise<void> {
  await adminAuditLogRepo.append(
    {
      actorAdminEmail: email,
      action,
      targetType: "admin",
      targetId: email,
      requestId: c.get("requestId") ?? null,
      ip: getClientIp(c),
    },
    transaction
  );
}

// ---------------------------------------------------------------------------
// OTP (fallback login) — now gated by the admin_users table, not env allowlist.
// ---------------------------------------------------------------------------

/**
 * POST /admin/auth/request-otp — send a 6-digit OTP. Always responds 202 with
 * the same body regardless of whether the address is a known active admin
 * (no enumeration).
 */
export async function postAdminRequestOtp(c: Context<AppEnv>) {
  const { email } = requestOtpSchema.parse(await c.req.json());

  const account = await adminAccountRepo.findByEmail(email);
  if (account && account.status === "active") {
    const code = await issueAdminOtp(email);
    if (code) {
      await db.transaction(async (tx) => {
        await queueTemplatedEmail({
          kind: "admin_otp",
          to: email,
          expiresAt: new Date(Date.now() + ADMIN_OTP_TTL_SEC * 1000),
          transaction: tx,
          template: "otp",
          props: {
            code,
            purpose: "sign-in",
            expiresInMinutes: Math.round(ADMIN_OTP_TTL_SEC / 60),
          },
        });
        await auditAuth(c, email, "admin.otp_requested", tx);
      });
    }
  }

  return respondOk(c, null, "OTP sent", 202);
}

/** POST /admin/auth/verify-otp — redeem the OTP and open a session. */
export async function postAdminVerifyOtp(c: Context<AppEnv>) {
  const { email, code } = verifyOtpSchema.parse(await c.req.json());

  const account = await adminAccountRepo.findByEmail(email);
  if (!account || account.status !== "active") throw new ForbiddenError("Not authorised as admin");

  const result = await consumeAdminOtp(email, code);
  if (!result.ok) {
    if (result.retryAfter !== undefined) c.header("Retry-After", String(result.retryAfter));
    if (result.reason === "backoff" || result.reason === "locked") {
      const message =
        result.reason === "locked"
          ? "Too many failed attempts — account locked for 24 hours."
          : `Too many failed attempts — try again in ${result.retryAfter} seconds.`;
      return c.json(
        { success: false, error: { code: "RATE_LIMITED", message }, responseCode: 429, message },
        429
      );
    }
    const message = "Invalid or expired code";
    return c.json(
      { success: false, error: { code: "UNAUTHENTICATED", message }, responseCode: 401, message },
      401
    );
  }

  await establishSession(c, account);
  await adminAccountRepo.setLastLogin(account.id);
  await auditAuth(c, email, "admin.login");
  return respondOk(c, { admin: toAdminView(account) });
}

// ---------------------------------------------------------------------------
// Password login (primary)
// ---------------------------------------------------------------------------

/** POST /admin/auth/login — email + password. Generic error to avoid enumeration. */
export async function postAdminLogin(c: Context<AppEnv>) {
  const { email, password } = adminPasswordLoginPayloadSchema.parse(await c.req.json());
  const lower = email.toLowerCase();

  const account = await adminAccountRepo.findByEmail(lower);
  const invalid = new UnauthorizedError("Invalid email or password");
  if (!account || account.status !== "active" || !account.passwordHash) throw invalid;

  const ok = await verifyPassword(password, account.passwordHash);
  if (!ok) throw invalid;

  await establishSession(c, account);
  await adminAccountRepo.setLastLogin(account.id);
  await auditAuth(c, lower, "admin.login");
  return respondOk(c, { admin: toAdminView(account) });
}

// ---------------------------------------------------------------------------
// Invite acceptance
// ---------------------------------------------------------------------------

/** POST /admin/auth/accept-invite — set the first password and activate. */
export async function postAdminAcceptInvite(c: Context<AppEnv>) {
  const { email, token, password } = adminAcceptInvitePayloadSchema.parse(await c.req.json());
  const lower = email.toLowerCase();

  const tokenOk = await consumeInviteToken(lower, token);
  if (!tokenOk) throw new ValidationError("Invalid or expired invitation");

  const account = await adminAccountRepo.findByEmail(lower);
  if (!account || account.status !== "invited") {
    throw new ValidationError("Invalid or expired invitation");
  }

  const passwordHash = await hashPassword(password);
  const activated = await adminAccountRepo.activateWithPassword({ email: lower, passwordHash });
  await establishSession(c, activated);
  await auditAuth(c, lower, "admin.accept_invite");
  return respondOk(c, { admin: toAdminView(activated) });
}

// ---------------------------------------------------------------------------
// Forgot password
// ---------------------------------------------------------------------------

/**
 * POST /admin/auth/request-password-reset — always 200 (anti-enumeration). Only
 * an existing active admin actually receives a link.
 */
export async function postAdminRequestPasswordReset(c: Context<AppEnv>) {
  const { email } = adminRequestPasswordResetPayloadSchema.parse(await c.req.json());
  const lower = email.toLowerCase();

  const account = await adminAccountRepo.findByEmail(lower);
  if (account && account.status === "active" && !(await resetRequestThrottled(lower))) {
    const token = await issueResetToken(lower);
    await db.transaction(async (tx) => {
      await queueTemplatedEmail({
        kind: "admin_password_reset",
        to: lower,
        expiresAt: new Date(Date.now() + ADMIN_RESET_TTL_SEC * 1000),
        transaction: tx,
        template: "admin-password-reset",
        props: {
          url: adminResetLink(lower, token),
          expiresInMinutes: Math.round(ADMIN_RESET_TTL_SEC / 60),
        },
      });
      await auditAuth(c, lower, "admin.password_reset_requested", tx);
    });
  }

  return respondOk(c, null, "If an account exists, a reset link has been sent", 200);
}

/** POST /admin/auth/reset-password — set a new password, revoke old sessions, sign in. */
export async function postAdminResetPassword(c: Context<AppEnv>) {
  const { email, token, password } = adminResetPasswordPayloadSchema.parse(await c.req.json());
  const lower = email.toLowerCase();

  const tokenOk = await consumeResetToken(lower, token);
  if (!tokenOk) throw new ValidationError("Invalid or expired reset link");

  const account = await adminAccountRepo.findByEmail(lower);
  if (!account || account.status !== "active")
    throw new ValidationError("Invalid or expired reset link");

  const passwordHash = await hashPassword(password);
  await adminAccountRepo.setPassword({ email: lower, passwordHash });
  // Revoke every existing session (they re-read the DB on next request); then
  // open a fresh one for this browser.
  await invalidateAdminSnapshot(lower);
  await establishSession(c, { ...account, passwordHash });
  await auditAuth(c, lower, "admin.password_reset");
  return respondOk(c, { admin: toAdminView(account) });
}

/** POST /admin/auth/change-password — authenticated password change. */
export async function postAdminChangePassword(c: Context<AppEnv>) {
  const admin = c.get("adminUser")!;
  const { currentPassword, newPassword } = adminChangePasswordPayloadSchema.parse(
    await c.req.json()
  );

  const account = await adminAccountRepo.findByEmail(admin.email);
  if (!account || !account.passwordHash) {
    throw new ValidationError("No password is set — use the reset flow instead");
  }
  const ok = await verifyPassword(currentPassword, account.passwordHash);
  if (!ok) throw new UnauthorizedError("Current password is incorrect");

  const passwordHash = await hashPassword(newPassword);
  await adminAccountRepo.setPassword({ email: account.email, passwordHash });
  // Keep this browser signed in; refresh the snapshot so nothing else changes.
  await setAdminSnapshot({
    id: account.id,
    email: account.email,
    name: account.name,
    role: account.role as AdminRole,
    status: "active",
  });
  await auditAuth(c, account.email, "admin.password_change");
  return respondOk(c, null, "Password changed");
}

// ---------------------------------------------------------------------------
// Session read + logout
// ---------------------------------------------------------------------------

/** GET /admin/auth/session — return the current admin identity. */
export function getAdminSession(c: Context<AppEnv>) {
  const admin = c.get("adminUser")!;
  return respondOk(c, {
    admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role },
  });
}

/** POST /admin/auth/logout — clear the cookie and invalidate the snapshot. */
export async function postAdminLogout(c: Context<AppEnv>) {
  const admin = c.get("adminUser");
  if (admin) await invalidateAdminSnapshot(admin.email);
  deleteCookie(c, ADMIN_COOKIE, { ...ADMIN_COOKIE_OPTS, maxAge: 0 });
  deleteCookie(c, ADMIN_COOKIE, LEGACY_ADMIN_COOKIE_OPTS);
  return respondOk(c, null, "Logged out");
}

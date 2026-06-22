import type { Context } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { ok } from "../lib/response";
import { UnauthorizedError, ForbiddenError } from "../lib/errors";
import { isAllowedAdminEmail, issueAdminOtp, consumeAdminOtp } from "../admin/otp.service";
import {
  signAdminSession,
  ADMIN_COOKIE,
  ADMIN_COOKIE_OPTS,
} from "../admin/session.service";
import { sendTemplatedEmail } from "../services/email.service";
import type { AppEnv } from "../types/http";

const requestOtpSchema = z.object({
  email: z.string().email().transform((e) => e.toLowerCase()),
});

const verifyOtpSchema = z.object({
  email: z.string().email().transform((e) => e.toLowerCase()),
  code: z.string().min(4).max(8),
});

/**
 * POST /admin/auth/request-otp — send a 6-digit OTP to the staff email.
 * Always responds 202 with the same body regardless of whether the address is
 * on the allowlist (no enumeration of valid admin emails).
 */
export async function postAdminRequestOtp(c: Context<AppEnv>) {
  const { email } = requestOtpSchema.parse(await c.req.json());

  if (isAllowedAdminEmail(email)) {
    const code = await issueAdminOtp(email);
    await sendTemplatedEmail({
      to: email,
      template: "otp",
      props: { code, purpose: "sign-in" },
    });
  }

  return c.json(ok({ status: "sent" }), 202);
}

/**
 * POST /admin/auth/verify-otp — redeem the OTP and set an httpOnly session cookie.
 */
export async function postAdminVerifyOtp(c: Context<AppEnv>) {
  const { email, code } = verifyOtpSchema.parse(await c.req.json());

  if (!isAllowedAdminEmail(email)) throw new ForbiddenError("Not authorised as admin");

  const valid = await consumeAdminOtp(email, code);
  if (!valid) throw new UnauthorizedError("Invalid or expired code");

  const claims = { id: email, email, name: null, role: "admin" as const };
  const token = await signAdminSession(claims);

  setCookie(c, ADMIN_COOKIE, token, ADMIN_COOKIE_OPTS);

  return c.json(
    ok({ admin: { id: claims.id, email: claims.email, name: claims.name, role: claims.role } })
  );
}

/**
 * GET /admin/auth/session — return the current admin identity from the cookie.
 * `requireAdmin` already verified the session, so we just read what it set.
 */
export function getAdminSession(c: Context<AppEnv>) {
  const admin = c.get("adminUser")!;
  return c.json(
    ok({ admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role } })
  );
}

/**
 * POST /admin/auth/logout — clear the session cookie.
 */
export function postAdminLogout(c: Context<AppEnv>) {
  deleteCookie(c, ADMIN_COOKIE, { ...ADMIN_COOKIE_OPTS, maxAge: 0 });
  return c.json(ok({ success: true }));
}

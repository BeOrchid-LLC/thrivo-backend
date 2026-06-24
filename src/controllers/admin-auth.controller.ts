import type { Context } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { respondOk } from "../lib/response";
import { ForbiddenError } from "../lib/errors";
import { isAllowedAdminEmail, issueAdminOtp, consumeAdminOtp } from "../admin/otp.service";
import { signAdminSession, ADMIN_COOKIE, ADMIN_COOKIE_OPTS } from "../admin/session.service";
import { sendTemplatedEmail } from "../services/email.service";
import type { AppEnv } from "../types/http";

const requestOtpSchema = z.object({
  email: z
    .string()
    .email()
    .transform((e) => e.toLowerCase()),
});

const verifyOtpSchema = z.object({
  email: z
    .string()
    .email()
    .transform((e) => e.toLowerCase()),
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

  return respondOk(c, null, "OTP sent", 202);
}

/**
 * POST /admin/auth/verify-otp — redeem the OTP and set an httpOnly session cookie.
 * Applies exponential backoff: 30 s → 5 min → 1 hr → 24 hr lockout.
 * Sets `Retry-After` on all failure responses so clients can surface a countdown.
 */
export async function postAdminVerifyOtp(c: Context<AppEnv>) {
  const { email, code } = verifyOtpSchema.parse(await c.req.json());

  if (!isAllowedAdminEmail(email)) throw new ForbiddenError("Not authorised as admin");

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

    // Wrong code — 401 with optional Retry-After hint for a UI countdown.
    const message = "Invalid or expired code";
    return c.json(
      { success: false, error: { code: "UNAUTHENTICATED", message }, responseCode: 401, message },
      401
    );
  }

  const claims = { id: email, email, name: null, role: "admin" as const };
  const token = await signAdminSession(claims);
  setCookie(c, ADMIN_COOKIE, token, ADMIN_COOKIE_OPTS);

  return respondOk(c, {
    admin: { id: claims.id, email: claims.email, name: claims.name, role: claims.role },
  });
}

/**
 * GET /admin/auth/session — return the current admin identity from the cookie.
 * `requireAdmin` already verified the session, so we just read what it set.
 */
export function getAdminSession(c: Context<AppEnv>) {
  const admin = c.get("adminUser")!;
  return respondOk(c, {
    admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role },
  });
}

/**
 * POST /admin/auth/logout — clear the session cookie.
 */
export function postAdminLogout(c: Context<AppEnv>) {
  deleteCookie(c, ADMIN_COOKIE, { ...ADMIN_COOKIE_OPTS, maxAge: 0 });
  return respondOk(c, null, "Logged out");
}

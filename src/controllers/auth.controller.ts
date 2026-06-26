import type { Context } from "hono";
import { respondOk } from "../lib/response";
import { env } from "../env";
import {
  ValidationError,
  UpstreamError,
  UnauthorizedError,
  AppError,
  RateLimitedError,
} from "../lib/errors";
import {
  magicLinkRequestSchema,
  magicLinkVerifySchema,
  otpRequestSchema,
  otpVerifySchema,
  refreshRequestSchema,
  type AuthSession,
} from "../auth/schemas";
import { requestMagicLink, verifyMagicLink } from "../auth/magic-link.service";
import { issueAuthOtp, verifyAuthOtp } from "../auth/otp.service";
import { rotateSession, revokeSession, type IssuedTokens } from "../auth/session.service";
import {
  completeGoogleSignIn,
  isGoogleConfigured,
  startGoogleSignIn,
} from "../auth/oauth/google.service";
import { sessionContext } from "../auth/request-context";
import {
  effectiveAccountStatus,
  isUserOnboarded,
  isUserOnboardingSkipped,
} from "../services/user.service";
import type { AppEnv } from "../types/http";
import { getValidatedInput } from "../middleware/validate";

function toAuthSession(tokens: IssuedTokens): AuthSession {
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    refreshExpiresAt: tokens.refreshExpiresAt.toISOString(),
  };
}

/**
 * Build the app deep link the OAuth callback returns to. Always derived from the
 * fixed `APP_AUTH_REDIRECT_URL` scheme + our own params — never from request
 * input, so the callback can't be coerced into an open redirect.
 */
function appRedirect(params: Record<string, string>): string {
  return `${env.APP_AUTH_REDIRECT_URL}?${new URLSearchParams(params).toString()}`;
}

/**
 * POST /auth/magic-link/request — email a sign-in link. Always 202 with a
 * generic body: the response never reveals whether the address has an account
 * (no user enumeration). `validate` has already parsed + lowercased the email.
 */
export async function postMagicLinkRequest(c: Context<AppEnv>) {
  const { email } = magicLinkRequestSchema.parse(getValidatedInput(c, "json"));
  await requestMagicLink(email);
  return respondOk(c, null, "Magic link sent", 202);
}

/**
 * POST /auth/magic-link/verify — redeem the token from the deep link and return
 * the access + refresh pair. 401 when the token is invalid/expired/used.
 */
export async function postMagicLinkVerify(c: Context<AppEnv>) {
  const { token } = magicLinkVerifySchema.parse(getValidatedInput(c, "json"));
  const tokens = await verifyMagicLink(token, sessionContext(c));
  return respondOk(c, toAuthSession(tokens));
}

/**
 * POST /auth/otp/request — email a one-time code. Always 202 with a generic
 * body, so this does not reveal account existence.
 */
export async function postOtpRequest(c: Context<AppEnv>) {
  const { email } = otpRequestSchema.parse(getValidatedInput(c, "json"));
  await issueAuthOtp(email);
  return respondOk(c, null, "OTP sent", 202);
}

/**
 * POST /auth/otp/verify — redeem the one-time code and return an access +
 * refresh pair. Wrong/expired codes use the standard error envelope.
 */
export async function postOtpVerify(c: Context<AppEnv>) {
  const { email, code } = otpVerifySchema.parse(getValidatedInput(c, "json"));
  const { result, tokens } = await verifyAuthOtp(email, code, sessionContext(c));

  if (!result.ok) {
    if (result.retryAfter !== undefined) c.header("Retry-After", String(result.retryAfter));
    if (result.reason === "backoff" || result.reason === "locked") {
      const message =
        result.reason === "locked"
          ? "Too many failed attempts — account locked for 24 hours."
          : `Too many failed attempts — try again in ${result.retryAfter} seconds.`;
      throw new RateLimitedError(message);
    }
    throw new UnauthorizedError("Invalid or expired code");
  }

  return respondOk(c, toAuthSession(tokens!));
}

/**
 * GET /auth/magic-link/callback — email CTA lands here (HTTPS). Verifies the
 * one-time token server-side, then bounces to the app deep link with issued
 * session tokens — same shape as the Google OAuth callback.
 */
export async function getMagicLinkCallback(c: Context<AppEnv>) {
  const token = c.req.query("token")?.trim();
  if (!token) return c.redirect(appRedirect({ error: "expired" }), 302);

  try {
    const tokens = await verifyMagicLink(token, sessionContext(c));
    return c.redirect(
      appRedirect({ token: tokens.accessToken, refresh: tokens.refreshToken }),
      302
    );
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return c.redirect(appRedirect({ error: "expired" }), 302);
    }
    if (err instanceof AppError) throw err;
    c.var.logger.warn({ err }, "magic-link callback failed");
    return c.redirect(appRedirect({ error: "auth_failed" }), 302);
  }
}

/**
 * POST /auth/refresh — rotate the refresh token for a fresh access + refresh
 * pair. 401 when the token is unknown, expired, or already used (rotation makes
 * a stolen-then-used token self-invalidating).
 */
export async function postRefresh(c: Context<AppEnv>) {
  const { refreshToken } = refreshRequestSchema.parse(getValidatedInput(c, "json"));
  const result = await rotateSession(refreshToken, sessionContext(c));
  if (!result) throw new UnauthorizedError("Your session has expired, please sign in again");
  return respondOk(c, toAuthSession(result.tokens));
}

/**
 * POST /auth/logout — revoke the refresh session (this device). Idempotent:
 * an unknown token still returns a success envelope so logout never fails the client.
 */
export async function postLogout(c: Context<AppEnv>) {
  const { refreshToken } = refreshRequestSchema.parse(getValidatedInput(c, "json"));
  await revokeSession(refreshToken);
  return respondOk(c, null, "Logged out");
}

/**
 * GET /auth/session — lightweight session facts for mobile cold-start restore.
 * `requireAuth` guarantees the caller; returns navigation-guard fields only.
 */
export function getAuthSession(c: Context<AppEnv>) {
  const user = c.get("user")!;
  return respondOk(c, {
    session: {
      userId: user.id,
      accountStatus: effectiveAccountStatus(user),
      isOnboarded: isUserOnboarded(user),
      isOnboardingSkipped: isUserOnboardingSkipped(user),
    },
  });
}

/**
 * GET /auth/google/start — redirect the system browser to Google's consent
 * screen. 502 if Google isn't configured for this environment.
 */
export async function getGoogleStart(c: Context<AppEnv>) {
  if (!isGoogleConfigured()) throw new UpstreamError("Google sign-in is not configured");
  return c.redirect(await startGoogleSignIn(), 302);
}

/**
 * GET /auth/google/callback — Google redirects here. On success, bounce back to
 * the app deep link with the issued tokens; on any auth failure, bounce back
 * with `?error=` so the app can show a retry rather than stranding the user in
 * the browser. Token in the deep link mirrors the native OAuth norm; tightening
 * to a one-time exchange code is a tracked follow-up.
 */
export async function getGoogleCallback(c: Context<AppEnv>) {
  // Google surfaces user-declined/consent errors as ?error=...
  const providerError = c.req.query("error");
  if (providerError) return c.redirect(appRedirect({ error: "access_denied" }), 302);

  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) throw new ValidationError("Missing code or state");

  try {
    const tokens = await completeGoogleSignIn(code, state, sessionContext(c));
    return c.redirect(
      appRedirect({ token: tokens.accessToken, refresh: tokens.refreshToken }),
      302
    );
  } catch (err) {
    c.var.logger.warn({ err }, "google oauth callback failed");
    return c.redirect(appRedirect({ error: "auth_failed" }), 302);
  }
}

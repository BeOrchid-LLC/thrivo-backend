import { z } from "zod";
import type { RouteContract } from "./common";
import { accountStatusSchema } from "./users";

/** Token pair returned to a client after a successful auth flow (email OTP, magic-link, or Google OAuth). */
export const authSessionSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  refreshExpiresAt: z.string(), // ISO-8601
});
export type AuthSession = z.infer<typeof authSessionSchema>;

/** Shared email primitive — RFC-validated, length-capped, case-normalized to match the backend. */
export const emailSchema = z
  .string()
  .email()
  .max(254)
  .transform((e) => e.toLowerCase());

/** POST /auth/otp/request payload */
export const otpRequestPayloadSchema = z.object({
  email: emailSchema,
});
export type OtpRequestPayload = z.infer<typeof otpRequestPayloadSchema>;

/** POST /auth/otp/verify payload */
export const otpVerifyPayloadSchema = z.object({
  email: emailSchema,
  code: z.string().regex(/^\d{6}$/),
});
export type OtpVerifyPayload = z.infer<typeof otpVerifyPayloadSchema>;

/**
 * POST /auth/magic-link/request payload
 * @deprecated Magic-link auth remains API-supported but is hidden in mobile while the UX is revisited.
 */
export const magicLinkRequestPayloadSchema = z.object({
  email: emailSchema,
});
export type MagicLinkRequestPayload = z.infer<typeof magicLinkRequestPayloadSchema>;

/**
 * POST /auth/magic-link/verify payload
 * @deprecated Magic-link auth remains API-supported but is hidden in mobile while the UX is revisited.
 */
export const magicLinkVerifyPayloadSchema = z.object({
  token: z.string().min(1),
});
export type MagicLinkVerifyPayload = z.infer<typeof magicLinkVerifyPayloadSchema>;

/** POST /auth/refresh + POST /auth/logout payload */
export const refreshPayloadSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshPayload = z.infer<typeof refreshPayloadSchema>;

/**
 * POST /auth/oauth/apple payload — native Sign in with Apple. The app posts the
 * signed `identityToken` from `expo-apple-authentication`, plus the display name
 * Apple supplies only on the first authorization (never re-sent).
 */
export const appleSignInPayloadSchema = z.object({
  identityToken: z.string().min(1).max(4096),
  name: z.string().max(120).optional(),
});
export type AppleSignInPayload = z.infer<typeof appleSignInPayloadSchema>;

/** Lightweight session facts for mobile cold-start restore (navigation guard). */
export const userSessionSchema = z.object({
  userId: z.string().uuid(),
  accountStatus: accountStatusSchema,
  isOnboarded: z.boolean(),
  isOnboardingSkipped: z.boolean(),
});
export type UserSession = z.infer<typeof userSessionSchema>;

export const userSessionResponseSchema = z.object({ session: userSessionSchema });
export type UserSessionResponse = z.infer<typeof userSessionResponseSchema>;

export const authRoutes = {
  requestOtp: {
    method: "POST",
    path: "/api/v1/auth/otp/request",
    auth: "public",
  },
  verifyOtp: {
    method: "POST",
    path: "/api/v1/auth/otp/verify",
    auth: "public",
  },
  // Deprecated: API remains available, but mobile no longer exposes this flow.
  requestMagicLink: {
    method: "POST",
    path: "/api/v1/auth/magic-link/request",
    auth: "public",
  },
  // Deprecated: API remains available, but mobile no longer exposes this flow.
  verifyMagicLink: {
    method: "POST",
    path: "/api/v1/auth/magic-link/verify",
    auth: "public",
  },
  // Email CTA lands here over HTTPS, then bounces to the app deep link.
  magicLinkCallback: {
    method: "GET",
    path: "/api/v1/auth/magic-link/callback",
    auth: "public",
  },
  refresh: {
    method: "POST",
    path: "/api/v1/auth/refresh",
    auth: "public",
  },
  logout: {
    method: "POST",
    path: "/api/v1/auth/logout",
    auth: "public",
  },
  getSession: {
    method: "GET",
    path: "/api/v1/auth/session",
    auth: "user",
  },
  googleStart: {
    method: "GET",
    path: "/api/v1/auth/google/start",
    auth: "public",
  },
  // Google redirects here after consent; the server bounces back to the app deep link.
  googleCallback: {
    method: "GET",
    path: "/api/v1/auth/google/callback",
    auth: "public",
  },
  // Native Sign in with Apple → identity token → token pair.
  oauthApple: {
    method: "POST",
    path: "/api/v1/auth/oauth/apple",
    auth: "public",
  },
} satisfies Record<string, RouteContract>;

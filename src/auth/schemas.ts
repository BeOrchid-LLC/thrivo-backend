import { z } from "zod";

/**
 * Backend-local auth request/response schemas. Kept here (not in the published
 * `@beorchid-llc/thrivo-contracts` package) while the hand-rolled auth is built
 * out; the shared response shape is promoted into contracts at mobile cutover
 * (Phase 4) so the package is published once, not per phase.
 */

export const magicLinkRequestSchema = z.object({
  email: z
    .string()
    .email()
    .max(254)
    .transform((e) => e.toLowerCase()),
});
export type MagicLinkRequest = z.infer<typeof magicLinkRequestSchema>;

export const magicLinkVerifySchema = z.object({
  token: z.string().min(1).max(512),
});
export type MagicLinkVerify = z.infer<typeof magicLinkVerifySchema>;

export const otpRequestSchema = z.object({
  email: z
    .string()
    .email()
    .max(254)
    .transform((e) => e.toLowerCase()),
});
export type OtpRequest = z.infer<typeof otpRequestSchema>;

export const otpVerifySchema = z.object({
  email: z
    .string()
    .email()
    .max(254)
    .transform((e) => e.toLowerCase()),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
});
export type OtpVerify = z.infer<typeof otpVerifySchema>;

/** Refresh + logout both take the opaque refresh token in the body. */
export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1).max(512),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

/**
 * Native Sign in with Apple: the app posts the signed `identityToken` it got from
 * `expo-apple-authentication`, plus the display name Apple supplies only on the
 * first authorization (never re-sent).
 */
export const appleSignInSchema = z.object({
  identityToken: z.string().min(1).max(4096),
  name: z.string().max(120).optional(),
});
export type AppleSignIn = z.infer<typeof appleSignInSchema>;

/** Token pair returned to a client after a successful auth flow. */
export const authSessionSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  refreshExpiresAt: z.string(), // ISO-8601
});
export type AuthSession = z.infer<typeof authSessionSchema>;

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

/** Refresh + logout both take the opaque refresh token in the body. */
export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1).max(512),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

/** Token pair returned to a client after a successful auth flow. */
export const authSessionSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  refreshExpiresAt: z.string(), // ISO-8601
});
export type AuthSession = z.infer<typeof authSessionSchema>;

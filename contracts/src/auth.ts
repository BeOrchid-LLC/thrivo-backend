import { z } from "zod";
import type { RouteContract } from "./common";
import { accountStatusSchema } from "./users";

/** Token pair returned to a client after a successful auth flow (magic-link or Google OAuth). */
export const authSessionSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  refreshExpiresAt: z.string(), // ISO-8601
});
export type AuthSession = z.infer<typeof authSessionSchema>;

/** POST /auth/magic-link/request payload */
export const magicLinkRequestPayloadSchema = z.object({
  email: z.string().email(),
});
export type MagicLinkRequestPayload = z.infer<typeof magicLinkRequestPayloadSchema>;

/** POST /auth/magic-link/verify payload */
export const magicLinkVerifyPayloadSchema = z.object({
  token: z.string().min(1),
});
export type MagicLinkVerifyPayload = z.infer<typeof magicLinkVerifyPayloadSchema>;

/** POST /auth/refresh + POST /auth/logout payload */
export const refreshPayloadSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshPayload = z.infer<typeof refreshPayloadSchema>;

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
  requestMagicLink: {
    method: "POST",
    path: "/api/v1/auth/magic-link/request",
    auth: "public",
  },
  verifyMagicLink: {
    method: "POST",
    path: "/api/v1/auth/magic-link/verify",
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
} satisfies Record<string, RouteContract>;

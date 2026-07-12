import { Hono } from "hono";
import { validate } from "../middleware/validate";
import {
  appleSignInPayloadSchema as appleSignInSchema,
  magicLinkRequestPayloadSchema as magicLinkRequestSchema,
  magicLinkVerifyPayloadSchema as magicLinkVerifySchema,
  otpRequestPayloadSchema as otpRequestSchema,
  otpVerifyPayloadSchema as otpVerifySchema,
  refreshPayloadSchema as refreshRequestSchema,
} from "../../contracts/src/auth";
import {
  getAuthSession,
  getGoogleCallback,
  getGoogleStart,
  getMagicLinkCallback,
  postAppleSignIn,
  postLogout,
  postMagicLinkRequest,
  postMagicLinkVerify,
  postOtpRequest,
  postOtpVerify,
  postRefresh,
} from "../controllers/auth.controller";
import { requireAuth } from "../middleware/require-auth";
import type { AppEnv } from "../types/http";

/**
 * `/api/v1/auth` — the hand-rolled auth router (public sign-in endpoints).
 * Mounted ahead of the legacy BetterAuth catch-all so these specific routes win.
 */
export const authRouter = new Hono<AppEnv>();

authRouter.post(
  "/magic-link/request",
  validate("json", magicLinkRequestSchema),
  postMagicLinkRequest
);
authRouter.post("/magic-link/verify", validate("json", magicLinkVerifySchema), postMagicLinkVerify);
authRouter.get("/magic-link/callback", getMagicLinkCallback);

authRouter.post("/otp/request", validate("json", otpRequestSchema), postOtpRequest);
authRouter.post("/otp/verify", validate("json", otpVerifySchema), postOtpVerify);

// Token lifecycle.
authRouter.post("/refresh", validate("json", refreshRequestSchema), postRefresh);
authRouter.post("/logout", validate("json", refreshRequestSchema), postLogout);

authRouter.get("/session", requireAuth, getAuthSession);

// Google OAuth (system browser → consent → callback → app deep link).
authRouter.get("/google/start", getGoogleStart);
authRouter.get("/google/callback", getGoogleCallback);

// Apple OAuth (native Sign in with Apple → identity token → token pair).
authRouter.post("/oauth/apple", validate("json", appleSignInSchema), postAppleSignIn);

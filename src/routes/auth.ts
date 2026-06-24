import { Hono } from "hono";
import { validate } from "../middleware/validate";
import {
  magicLinkRequestSchema,
  magicLinkVerifySchema,
  refreshRequestSchema,
} from "../auth/schemas";
import {
  getAuthSession,
  getGoogleCallback,
  getGoogleStart,
  getMagicLinkCallback,
  postLogout,
  postMagicLinkRequest,
  postMagicLinkVerify,
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

// Token lifecycle.
authRouter.post("/refresh", validate("json", refreshRequestSchema), postRefresh);
authRouter.post("/logout", validate("json", refreshRequestSchema), postLogout);

authRouter.get("/session", requireAuth, getAuthSession);

// Google OAuth (system browser → consent → callback → app deep link).
authRouter.get("/google/start", getGoogleStart);
authRouter.get("/google/callback", getGoogleCallback);

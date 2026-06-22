import { Hono } from "hono";
import { validate } from "../middleware/validate";
import { magicLinkRequestSchema, magicLinkVerifySchema } from "../auth/schemas";
import {
  getGoogleCallback,
  getGoogleStart,
  postMagicLinkRequest,
  postMagicLinkVerify,
} from "../controllers/auth.controller";
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

// Google OAuth (system browser → consent → callback → app deep link).
authRouter.get("/google/start", getGoogleStart);
authRouter.get("/google/callback", getGoogleCallback);

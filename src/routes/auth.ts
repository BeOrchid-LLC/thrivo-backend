import { Hono } from "hono";
import { validate } from "../middleware/validate";
import { magicLinkRequestSchema, magicLinkVerifySchema } from "../auth/schemas";
import { postMagicLinkRequest, postMagicLinkVerify } from "../controllers/auth.controller";
import type { AppEnv } from "../types/http";

/**
 * `/api/v1/auth` — the hand-rolled auth router (public sign-in endpoints).
 * Mounted ahead of the legacy BetterAuth catch-all so these specific routes win.
 * Google OAuth (Phase 3) adds its start/callback routes here.
 */
export const authRouter = new Hono<AppEnv>();

authRouter.post(
  "/magic-link/request",
  validate("json", magicLinkRequestSchema),
  postMagicLinkRequest
);
authRouter.post("/magic-link/verify", validate("json", magicLinkVerifySchema), postMagicLinkVerify);

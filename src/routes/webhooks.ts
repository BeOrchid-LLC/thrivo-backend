import { Hono } from "hono";
import { postRevenueCatWebhook, postClerkWebhook } from "../controllers/webhooks.controller";
import type { AppEnv } from "../types/http";

/**
 * Inbound provider webhooks. These are authenticated by a provider shared secret
 * (verified in the handler), not by the user session — they carry no Thrivo
 * cookie or bearer token. Kept on their own router so that contract stays
 * explicit and future providers (Stripe, etc.) slot in without touching the
 * user-facing routers.
 */
export const webhooksRouter = new Hono<AppEnv>();

webhooksRouter.post("/revenuecat", postRevenueCatWebhook);
webhooksRouter.post("/clerk", postClerkWebhook);

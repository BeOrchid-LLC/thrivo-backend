import type { Context } from "hono";
import { respondOk } from "../lib/response";
import { handleRevenueCatWebhook } from "../services/billing-webhook.service";
import type { AppEnv } from "../types/http";

/**
 * RevenueCat webhook sink. Authenticated by the shared Authorization secret
 * inside the service (not the user auth middleware). A bad signature throws
 * ForbiddenError → 403, which RevenueCat treats as a failure and retries; a
 * processed/duplicate/ignored event returns 200 so it stops retrying.
 */
export async function postRevenueCatWebhook(c: Context<AppEnv>) {
  const authHeader = c.req.header("authorization");
  const body = await c.req.json().catch(() => ({}));
  const outcome = await handleRevenueCatWebhook(authHeader, body);
  return respondOk(c, { outcome }, "Webhook received");
}

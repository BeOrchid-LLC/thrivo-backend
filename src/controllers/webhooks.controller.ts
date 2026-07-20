import type { Context } from "hono";
import { respondOk } from "../lib/response";
import { handleRevenueCatWebhook } from "../services/billing-webhook.service";
import { parseClerkWebhook, handleClerkWebhookEvent } from "../services/clerk-webhook.service";
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

/**
 * Clerk user-lifecycle webhook sink. Svix signature is verified in the service
 * (throws ForbiddenError → 403 on bad sig). Handles user.created / user.updated
 * / user.deleted to keep the domain `users` table in sync with Clerk.
 */
export async function postClerkWebhook(c: Context<AppEnv>) {
  // svix requires the raw body string for signature verification.
  const rawBody = await c.req.text();
  const svixHeaders = {
    "svix-id": c.req.header("svix-id") ?? "",
    "svix-timestamp": c.req.header("svix-timestamp") ?? "",
    "svix-signature": c.req.header("svix-signature") ?? "",
  };

  const event = parseClerkWebhook(rawBody, svixHeaders);
  const outcome = await handleClerkWebhookEvent(event);
  return respondOk(c, { outcome }, "Webhook received");
}

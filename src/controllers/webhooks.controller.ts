import type { Context } from "hono";
import { respondOk } from "../lib/response";
import { handleRevenueCatWebhook } from "../services/billing-webhook.service";
import { parseClerkWebhook, handleClerkWebhookEvent } from "../services/clerk-webhook.service";
import {
  parseAdminClerkWebhook,
  handleAdminClerkWebhookEvent,
} from "../services/admin-clerk-webhook.service";
import type { AppEnv } from "../types/http";
import { handleResendWebhook, parseResendWebhook } from "../services/resend-webhook.service";

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
 * BeOrchid Consumer Clerk webhook sink. Keeps the domain `users` table in sync.
 * Svix signature verified in the service (ForbiddenError → 403 on bad sig).
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

/**
 * BeOrchid Admin Clerk webhook sink. Keeps the `admin_users` table in sync with
 * the Admin Clerk application. Svix signature verified against CLERK_ADMIN_WEBHOOK_SECRET.
 */
export async function postClerkAdminWebhook(c: Context<AppEnv>) {
  const rawBody = await c.req.text();
  const svixHeaders = {
    "svix-id": c.req.header("svix-id") ?? "",
    "svix-timestamp": c.req.header("svix-timestamp") ?? "",
    "svix-signature": c.req.header("svix-signature") ?? "",
  };

  const event = parseAdminClerkWebhook(rawBody, svixHeaders);
  const outcome = await handleAdminClerkWebhookEvent(event, svixHeaders["svix-id"]);
  return respondOk(c, { outcome }, "Webhook received");
}

export async function postResendWebhook(c: Context<AppEnv>) {
  const rawBody = await c.req.text();
  const headers = {
    "svix-id": c.req.header("svix-id") ?? "",
    "svix-timestamp": c.req.header("svix-timestamp") ?? "",
    "svix-signature": c.req.header("svix-signature") ?? "",
  };
  const payload = parseResendWebhook(rawBody, headers);
  const outcome = await handleResendWebhook(headers["svix-id"], payload);
  return respondOk(c, { outcome }, "Webhook received");
}

import type { Context } from "hono";
import { z } from "zod";
import { NotFoundError } from "../lib/errors";
import { respondOk } from "../lib/response";
import { getClientIp } from "../lib/request-ip";
import { enqueue, QUEUE_NAMES } from "../lib/queue";
import { adminBillingRepo, userRepo } from "../repositories";
import * as adminAuditLogRepo from "../repositories/admin-audit-log.repository";
import type { AppEnv } from "../types/http";

const eventsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  eventType: z
    .enum(["trial_started", "trial_converted", "trial_cancelled", "renewed", "expired"])
    .optional(),
});

const webhooksQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  provider: z.enum(["revenuecat", "stripe"]).optional(),
  status: z.enum(["received", "processed", "failed"]).optional(),
});

/** GET /admin/billing/events — keyset list of subscription funnel events. */
export async function listAdminBillingEvents(c: Context<AppEnv>) {
  const q = eventsQuerySchema.parse(c.req.query());
  const r = await adminBillingRepo.listEventsPaged(q);
  return respondOk(c, {
    items: r.items,
    pagination: { limit: r.limit, total: r.total, nextCursor: r.nextCursor },
  });
}

/** GET /admin/users/:id/billing-events — per-user event timeline. */
export async function getAdminUserBillingEvents(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const events = await adminBillingRepo.listEventsForUser(id);
  return respondOk(c, { events });
}

/** GET /admin/webhooks — keyset list of inbound webhook deliveries. */
export async function listAdminWebhooks(c: Context<AppEnv>) {
  const q = webhooksQuerySchema.parse(c.req.query());
  const r = await adminBillingRepo.listWebhooksPaged(q);
  return respondOk(c, {
    items: r.items,
    pagination: { limit: r.limit, total: r.total, nextCursor: r.nextCursor },
  });
}

/** GET /admin/webhooks/:id — raw payload (admin-only; may carry PII). */
export async function getAdminWebhook(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const webhook = await adminBillingRepo.findWebhookDetail(id);
  if (!webhook) throw new NotFoundError("Webhook event not found");
  return respondOk(c, { webhook });
}

/**
 * POST /admin/users/:id/reconcile-subscription — enqueue the (idempotent,
 * global) subscription reconcile backstop and audit the trigger. Reconcile is
 * whole-fleet by design; this is the operator's "kick the reconciler" button
 * for a stuck user. Admin-only.
 */
export async function reconcileAdminUserSubscription(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const user = await userRepo.findById(id);
  if (!user) throw new NotFoundError("User not found");

  await enqueue(QUEUE_NAMES.maintenance, "reconcile-subscriptions", {});
  await adminAuditLogRepo.append({
    actorAdminEmail: c.get("adminUser")!.email,
    action: "subscription.reconcile_triggered",
    targetType: "user",
    targetId: id,
    requestId: c.get("requestId") ?? null,
    ip: getClientIp(c),
  });

  return respondOk(c, null, "Reconcile enqueued", 202);
}

import type { Context } from "hono";
import { adminCancelPayloadSchema, adminRefundPayloadSchema } from "../../contracts/src/admin";
import { respondOk } from "../lib/response";
import { getClientIp } from "../lib/request-ip";
import { getValidatedInput } from "../middleware/validate";
import {
  adminCancelUserSubscription,
  adminRefundUserSubscription,
} from "../services/admin-subscription-actions.service";
import type { AuditActor } from "../repositories/admin-audit-log.repository";
import type { AppEnv } from "../types/http";

function auditActor(c: Context<AppEnv>): AuditActor {
  const admin = c.get("adminUser")!;
  return {
    actorAdminEmail: admin.email,
    requestId: c.get("requestId") ?? null,
    ip: getClientIp(c),
  };
}

/** POST /admin/users/:id/subscription/cancel — operator-initiated cancellation (audited). */
export async function cancelAdminUserSubscription(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const input = adminCancelPayloadSchema.parse(getValidatedInput(c, "json"));
  const result = await adminCancelUserSubscription(id, input, auditActor(c));
  return respondOk(c, result, "Subscription canceled");
}

/** POST /admin/users/:id/subscription/refund — record a refund decision (audited). */
export async function refundAdminUserSubscription(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const input = adminRefundPayloadSchema.parse(getValidatedInput(c, "json"));
  const result = await adminRefundUserSubscription(id, input, auditActor(c));
  return respondOk(c, result, "Refund recorded");
}

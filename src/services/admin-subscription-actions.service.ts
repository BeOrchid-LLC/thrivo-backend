import type {
  AdminCancelPayload,
  AdminRefundPayload,
  AdminUserDetail,
} from "../../contracts/src/admin";
import { ConflictError, NotFoundError } from "../lib/errors";
import { adminUserRepo, subscriptionRepo } from "../repositories";
import type { AuditActor } from "../repositories/admin-audit-log.repository";
import * as adminAuditLogRepo from "../repositories/admin-audit-log.repository";
import { persistSubscriptionAndMirror } from "./subscription.service";

async function requireUserDetail(userId: string): Promise<AdminUserDetail> {
  const user = await adminUserRepo.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  return user;
}

/**
 * Admin-initiated cancellation. Unlike the user-facing `cancelSubscription`,
 * this does NOT call the billing adapter (a prod-throwing stub — the real
 * store-side cancellation happens out-of-band in App Store/Play/RevenueCat).
 * It records the cancellation in our own projection + user mirror so the admin
 * view and entitlement reflect the operator's decision immediately; the next
 * RevenueCat webhook remains the source of truth and will reconcile. The
 * decision is audited.
 */
export async function adminCancelUserSubscription(
  userId: string,
  input: AdminCancelPayload,
  audit: AuditActor,
  now = new Date()
): Promise<{ user: AdminUserDetail }> {
  const existing = await subscriptionRepo.getByUser(userId);
  if (!existing || existing.status === "expired") {
    throw new ConflictError("User has no active subscription to cancel");
  }

  await persistSubscriptionAndMirror(userId, {
    ...existing,
    status: "canceled",
    cancelAtPeriodEnd: true,
    // Keep the remaining paid period if one is known; otherwise access ends now.
    currentPeriodEnd: existing.currentPeriodEnd ?? now,
    lastEventAt: now,
  });

  await adminAuditLogRepo.append({
    actorAdminEmail: audit.actorAdminEmail,
    action: "subscription.admin_cancel",
    targetType: "user",
    targetId: userId,
    before: { status: existing.status, cancelAtPeriodEnd: existing.cancelAtPeriodEnd },
    after: { status: "canceled", cancelAtPeriodEnd: true, reason: input.reason },
    requestId: audit.requestId,
    ip: audit.ip,
  });

  return { user: await requireUserDetail(userId) };
}

/**
 * Admin-initiated refund. There is no server-side money-movement path in this
 * codebase (RevenueCat only, no Stripe) — an actual refund is issued in the
 * App Store / Play console. This endpoint records the refund DECISION (amount +
 * reason) as an audited event so the operator's action is traceable; it does
 * not move money or change entitlement on its own.
 */
export async function adminRefundUserSubscription(
  userId: string,
  input: AdminRefundPayload,
  audit: AuditActor
): Promise<{ user: AdminUserDetail }> {
  // Ensure the user exists before recording anything against them.
  const user = await requireUserDetail(userId);

  await adminAuditLogRepo.append({
    actorAdminEmail: audit.actorAdminEmail,
    action: "subscription.admin_refund",
    targetType: "user",
    targetId: userId,
    after: { amountCents: input.amountCents ?? null, reason: input.reason },
    requestId: audit.requestId,
    ip: audit.ip,
  });

  return { user };
}

import type {
  CancelSubscriptionPayload,
  PurchaseSubscriptionPayload,
  StartTrialPayload,
  SubscriptionPlan,
  SubscriptionPlanInfo,
  SubscriptionState,
} from "../../contracts/src/subscriptions";
import { db } from "../../db";
import type { NewSubscriptionRow, UserRow } from "../../db/schema";
import { billingAdapter } from "../integrations/billing";
import { ConflictError, ForbiddenError, NotFoundError, UpstreamError } from "../lib/errors";
import { subscriptionRepo, userRepo } from "../repositories";
import type { Subscription } from "../repositories/subscription.repository";
import { getEffectiveSettings } from "./settings.service";

const PLANS: Record<SubscriptionPlan, SubscriptionPlanInfo> = {
  monthly: {
    plan: "monthly",
    productId: "thrivo_premium_monthly",
    priceLabel: "$14.99",
    billingPeriodLabel: "month",
  },
  annual: {
    plan: "annual",
    productId: "thrivo_premium_annual",
    priceLabel: "$150",
    billingPeriodLabel: "year",
  },
};

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function addBillingPeriod(date: Date, plan: SubscriptionPlan): Date {
  const next = new Date(date);
  if (plan === "annual") next.setFullYear(next.getFullYear() + 1);
  else next.setMonth(next.getMonth() + 1);
  return next;
}

function planFromProductId(productId: string | null): SubscriptionPlan | null {
  if (productId === PLANS.annual.productId) return "annual";
  if (productId === PLANS.monthly.productId) return "monthly";
  return null;
}

function publicStatus(row: Subscription | null): SubscriptionState["status"] {
  if (!row) return "none";
  if (row.status === "trialing") return "trialing";
  if (row.status === "canceled") return "canceled";
  if (row.status === "expired") return "expired";
  if (row.status === "active" || row.status === "in_grace" || row.status === "past_due") {
    return "active";
  }
  return "none";
}

function hasAccess(user: UserRow, row: Subscription | null, now: Date): boolean {
  if (user.tier !== "premium") return false;
  if (!row) return true;
  if (row.status === "expired") return false;
  if (row.status === "canceled" && row.currentPeriodEnd && row.currentPeriodEnd <= now)
    return false;
  return true;
}

export async function getSubscriptionState(
  user: UserRow,
  now = new Date()
): Promise<{ subscription: SubscriptionState }> {
  const [row, settings] = await Promise.all([
    subscriptionRepo.getByUser(user.id),
    getEffectiveSettings(user.id),
  ]);
  const plan = planFromProductId(row?.productId ?? null);
  const accessEndsAt = row?.currentPeriodEnd?.toISOString() ?? null;

  return {
    subscription: {
      entitlement: hasAccess(user, row, now) ? "premium" : "free",
      status: publicStatus(row),
      plan,
      productId: row?.productId ?? null,
      priceLabel: plan ? PLANS[plan].priceLabel : null,
      renewsAt: row?.cancelAtPeriodEnd ? null : accessEndsAt,
      accessEndsAt,
      cancelAtPeriodEnd: row?.cancelAtPeriodEnd ?? false,
      trialUsed: Boolean(user.trialEndsAt ?? row?.trialEnd),
      trialDays: settings.effective.trialDays,
      plans: Object.values(PLANS),
    },
  };
}

export async function startTrial(
  user: UserRow,
  input: StartTrialPayload,
  now = new Date()
): Promise<{ subscription: SubscriptionState }> {
  const settings = await getEffectiveSettings(user.id);
  if (!settings.effective.trialsEnabled) throw new ForbiddenError("Free trials are unavailable");

  const existing = await subscriptionRepo.getByUser(user.id);
  if (user.trialEndsAt || existing?.trialEnd) {
    throw new ConflictError("Free trial has already been used");
  }

  const plan = input.plan;
  const product = PLANS[plan];
  const billing = await billingAdapter.startTrial({
    userId: user.id,
    plan,
    productId: product.productId,
  });
  if (!billing.confirmed) throw new UpstreamError("Billing provider did not confirm trial start");

  const trialEnd = addDays(now, settings.effective.trialDays);
  await persistSubscriptionAndMirror(user.id, {
    userId: user.id,
    rcAppUserId: billing.providerUserId,
    provider: billing.provider,
    productId: product.productId,
    status: "trialing",
    trialEnd,
    currentPeriodStart: now,
    currentPeriodEnd: trialEnd,
    cancelAtPeriodEnd: false,
    lastEventAt: now,
  });

  const updated = await userRepo.findById(user.id);
  if (!updated) throw new NotFoundError("User not found");
  return getSubscriptionState(updated, now);
}

export async function purchaseSubscription(
  user: UserRow,
  input: PurchaseSubscriptionPayload,
  now = new Date()
): Promise<{ subscription: SubscriptionState }> {
  const settings = await getEffectiveSettings(user.id);
  if (!settings.effective.purchasesEnabled) throw new ForbiddenError("Purchases are unavailable");

  const existing = await subscriptionRepo.getByUser(user.id);
  if (existing && existing.status !== "expired" && existing.status !== "canceled") {
    return getSubscriptionState(user, now);
  }

  const plan = input.plan;
  const product = PLANS[plan];
  const billing = await billingAdapter.purchase({
    userId: user.id,
    plan,
    productId: product.productId,
  });
  if (!billing.confirmed) throw new UpstreamError("Billing provider did not confirm purchase");

  await persistSubscriptionAndMirror(user.id, {
    userId: user.id,
    rcAppUserId: billing.providerUserId,
    provider: billing.provider,
    productId: product.productId,
    status: "active",
    trialEnd: user.trialEndsAt,
    currentPeriodStart: now,
    currentPeriodEnd: addBillingPeriod(now, plan),
    cancelAtPeriodEnd: false,
    lastEventAt: now,
  });

  const updated = await userRepo.findById(user.id);
  if (!updated) throw new NotFoundError("User not found");
  return getSubscriptionState(updated, now);
}

export async function cancelSubscription(
  user: UserRow,
  input: CancelSubscriptionPayload,
  now = new Date()
): Promise<{ subscription: SubscriptionState }> {
  const settings = await getEffectiveSettings(user.id);
  if (!settings.effective.cancellationsEnabled) {
    throw new ForbiddenError("Subscription cancellation is unavailable");
  }

  const existing = await subscriptionRepo.getByUser(user.id);
  if (!existing || existing.status === "expired") throw new ConflictError("No active subscription");
  if (existing.cancelAtPeriodEnd && existing.status === "canceled")
    return getSubscriptionState(user, now);

  const plan = planFromProductId(existing.productId) ?? "monthly";
  const billing = await billingAdapter.cancel({
    userId: user.id,
    productId: existing.productId,
    reason: input.reason,
  });
  if (!billing.confirmed) throw new UpstreamError("Billing provider did not confirm cancellation");

  await persistSubscriptionAndMirror(user.id, {
    ...existing,
    status: "canceled",
    cancelAtPeriodEnd: true,
    currentPeriodEnd: existing.currentPeriodEnd ?? addBillingPeriod(now, plan),
    lastEventAt: now,
  });

  const updated = await userRepo.findById(user.id);
  if (!updated) throw new NotFoundError("User not found");
  return getSubscriptionState(updated, now);
}

async function persistSubscriptionAndMirror(
  userId: string,
  subscription: NewSubscriptionRow
): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await subscriptionRepo.upsertFromWebhook(subscription, tx);
    await userRepo.updateProfile(
      userId,
      {
        tier: row.status === "expired" ? "free" : "premium",
        accountStatus: row.status === "trialing" ? "free_trial" : "paid",
        subscriptionStatus: row.status,
        trialEndsAt: row.trialEnd,
      },
      tx
    );
  });
}

export const subscriptionPlans = PLANS;

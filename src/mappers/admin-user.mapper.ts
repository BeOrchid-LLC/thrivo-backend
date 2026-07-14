import type {
  AdminSubscriptionStatus,
  AdminUserDetail,
  AdminUserStatus,
} from "../../contracts/src/admin";
import type { SubscriptionRow } from "../../db/schema";
import type { UserRow } from "../../db/schema";
import { toUserProfile } from "./user-profile.mapper";
import { subscriptionPlans } from "../services/subscription.service";

/** The 4 fields derivable straight from a `subscriptions` row — the rest of
 *  the full contract shape only exists once `AdminUserDetailExtras` is merged
 *  in, so `toAdminSubscription`/the users-list aggregate path deal in this
 *  narrower type, not the full `AdminUserDetail["subscription"]`. */
type AdminSubscriptionBase = Pick<
  NonNullable<AdminUserDetail["subscription"]>,
  "status" | "priceLabel" | "renewsAt" | "cancelAtPeriodEnd"
>;

export type AdminUserAggregates = {
  totalFoodLogs: number;
  currentStreakDays: number;
  subscription: AdminSubscriptionBase | null;
};

/**
 * Single-user-only extras for the admin user-detail page (not the users list,
 * which stays on the cheaper `AdminUserAggregates` path) — device info,
 * conversion trigger, weight/check-in counts, avg kcal, and the extended
 * subscription fields (trial/first-charge dates, revenue-to-date, ids).
 */
export type AdminUserDetailExtras = {
  device: AdminUserDetail["device"];
  convertedViaTrigger: string | null;
  totalWeightLogs: number;
  totalCheckIns: number;
  avgDailyKcal: number | null;
  subscriptionExtras: Omit<
    NonNullable<AdminUserDetail["subscription"]>,
    keyof AdminSubscriptionBase
  > | null;
};

export function emptyDetailExtras(): AdminUserDetailExtras {
  return {
    device: null,
    convertedViaTrigger: null,
    totalWeightLogs: 0,
    totalCheckIns: 0,
    avgDailyKcal: null,
    subscriptionExtras: null,
  };
}

/** Fallback when `subscriptionExtras` wasn't computed (e.g. the users-list
 *  path) but a base subscription still exists — every field must be present
 *  for the schema, so an "unknown" render ("—") beats a missing key. */
const NULL_SUBSCRIPTION_EXTRAS = {
  trialStartedAt: null,
  trialConvertedAt: null,
  firstChargeAt: null,
  firstChargeAmountCents: null,
  revenueToDateCents: null,
  stripeCustomerId: null,
  rcAppUserId: null,
} satisfies AdminUserDetailExtras["subscriptionExtras"];

function resolveStatus(u: { deletedAt: Date | null; accountStatus: string }): AdminUserStatus {
  if (u.deletedAt !== null) return "deleted";
  if (u.accountStatus === "dormant") return "suspended";
  return "active";
}

function mapSubscriptionStatus(status: string): AdminSubscriptionStatus {
  if (status === "trialing") return "trialing";
  if (status === "canceled") return "canceled";
  if (status === "expired") return "expired";
  if (status === "active" || status === "in_grace" || status === "past_due") return "active";
  return "none";
}

/** "$14.99 / month" — falls back to the raw product id for an unrecognized
 *  one rather than hiding it. */
function planPriceLabel(productId: string | null): string | null {
  if (productId === subscriptionPlans.monthly.productId) {
    const plan = subscriptionPlans.monthly;
    return `${plan.priceLabel} / ${plan.billingPeriodLabel}`;
  }
  if (productId === subscriptionPlans.annual.productId) {
    const plan = subscriptionPlans.annual;
    return `${plan.priceLabel} / ${plan.billingPeriodLabel}`;
  }
  return productId;
}

export function toAdminSubscription(row: SubscriptionRow): AdminSubscriptionBase {
  return {
    status: mapSubscriptionStatus(row.status),
    priceLabel: planPriceLabel(row.productId),
    renewsAt: row.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
  };
}

export function toAdminUserDetail(
  row: UserRow,
  aggregates: AdminUserAggregates,
  extras: AdminUserDetailExtras = emptyDetailExtras()
): AdminUserDetail {
  const profile = toUserProfile(row);
  const subscription = aggregates.subscription
    ? { ...aggregates.subscription, ...(extras.subscriptionExtras ?? NULL_SUBSCRIPTION_EXTRAS) }
    : null;

  return {
    ...profile,
    name: row.name,
    onboardingSkipped: row.onboardingSkipped,
    subscriptionStatus: row.subscriptionStatus,
    deletedAt: row.deletedAt,
    updatedAt: row.updatedAt,
    status: resolveStatus(row),
    lastActiveAt: row.lastActiveAt ? row.lastActiveAt.toISOString() : null,
    totalFoodLogs: aggregates.totalFoodLogs,
    currentStreakDays: aggregates.currentStreakDays,
    subscription,
    device: extras.device,
    convertedViaTrigger: extras.convertedViaTrigger,
    stats: {
      currentStreakDays: aggregates.currentStreakDays,
      totalFoodLogs: aggregates.totalFoodLogs,
      totalWeightLogs: extras.totalWeightLogs,
      totalCheckIns: extras.totalCheckIns,
      avgDailyKcal: extras.avgDailyKcal,
    },
  };
}

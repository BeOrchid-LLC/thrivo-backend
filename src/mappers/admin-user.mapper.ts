import type {
  AdminSubscriptionStatus,
  AdminUserDetail,
  AdminUserStatus,
} from "../../contracts/src/admin";
import type { SubscriptionRow } from "../../db/schema";
import type { UserRow } from "../../db/schema";
import { toUserProfile } from "./user-profile.mapper";

export type AdminUserAggregates = {
  totalFoodLogs: number;
  currentStreakDays: number;
  subscription: AdminUserDetail["subscription"];
};

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

export function toAdminSubscription(row: SubscriptionRow): AdminUserDetail["subscription"] {
  return {
    status: mapSubscriptionStatus(row.status),
    priceLabel: row.productId,
    renewsAt: row.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
  };
}

export function toAdminUserDetail(row: UserRow, aggregates: AdminUserAggregates): AdminUserDetail {
  const profile = toUserProfile(row);

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
    subscription: aggregates.subscription,
  };
}

import { and, count, desc, eq, ilike, inArray, type SQL } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { subscriptions, users, type SubStatus } from "../../db/schema";
import type { AdminSubscriptionRow } from "../../contracts/src/admin-subscriptions";
import type { AdminSubscriptionStatus } from "../../contracts/src/admin";

/**
 * The `subscriptions` table uses the RevenueCat-shaped `sub_status` enum
 * (trialing|active|in_grace|past_due|canceled|expired). The admin surface
 * collapses the two "still paying, just flagged" states (in_grace/past_due)
 * into `active` — the operator cares that access is live, not the dunning
 * substate. `none` is unreachable here (every row in this table has a status);
 * it exists in the contract for the user-detail view where a user may have no
 * subscription row at all.
 */
function toAdminStatus(status: SubStatus): AdminSubscriptionStatus {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
    case "in_grace":
    case "past_due":
      return "active";
    case "canceled":
      return "canceled";
    case "expired":
      return "expired";
  }
}

/** Best-effort human label from the store product id (no price table exists). */
function priceLabelFor(productId: string | null): string | null {
  if (!productId) return null;
  const id = productId.toLowerCase();
  if (id.includes("annual") || id.includes("year")) return "Annual";
  if (id.includes("month")) return "Monthly";
  return null;
}

const STATUS_FILTER: Record<string, SubStatus[]> = {
  active: ["active", "in_grace", "past_due"],
  trialing: ["trialing"],
  canceled: ["canceled"],
  expired: ["expired"],
};

export type ListSubscriptionsParams = {
  offset: number;
  limit: number;
  /** admin status tab: active | trialing | canceled | expired (else all) */
  status?: string;
  /** free-text search on user email */
  q?: string;
};

export async function listPaged(
  params: ListSubscriptionsParams,
  tx: Executor = db
): Promise<{ rows: AdminSubscriptionRow[]; total: number }> {
  const statuses = params.status ? STATUS_FILTER[params.status] : undefined;
  const clauses: (SQL | undefined)[] = [
    statuses && statuses.length > 0 ? inArray(subscriptions.status, statuses) : undefined,
    params.q ? ilike(users.email, `%${params.q}%`) : undefined,
  ];
  const where = and(...clauses);

  const [rows, [{ value: total }]] = await Promise.all([
    tx
      .select({
        id: subscriptions.id,
        userId: subscriptions.userId,
        userEmail: users.email,
        tier: users.tier,
        status: subscriptions.status,
        productId: subscriptions.productId,
        currentPeriodStart: subscriptions.currentPeriodStart,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
      })
      .from(subscriptions)
      .innerJoin(users, eq(users.id, subscriptions.userId))
      .where(where)
      .orderBy(desc(subscriptions.lastEventAt), desc(subscriptions.id))
      .limit(params.limit)
      .offset(params.offset),
    tx
      .select({ value: count() })
      .from(subscriptions)
      .innerJoin(users, eq(users.id, subscriptions.userId))
      .where(where),
  ]);

  return {
    rows: rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      userEmail: row.userEmail,
      entitlement: row.tier,
      status: toAdminStatus(row.status),
      priceLabel: priceLabelFor(row.productId),
      // Populated from user_events once that instrumentation lands; null today.
      upgradeTrigger: null,
      startedAt: row.currentPeriodStart ? row.currentPeriodStart.toISOString() : null,
      renewsAt: row.currentPeriodEnd ? row.currentPeriodEnd.toISOString() : null,
    })),
    total: Number(total),
  };
}

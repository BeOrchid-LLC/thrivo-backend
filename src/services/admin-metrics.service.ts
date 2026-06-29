import { and, count, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { subscriptions, users } from "../../db/schema";
import type { AdminDashboardMetrics } from "../../contracts/src/admin-analytics";

/**
 * v1 dashboard aggregates, typed to the shared `AdminDashboardMetrics` contract.
 * DAU/MAU read the `last_active_at` activity signal (Phase 4); MRR/churn stay 0
 * until the billing analytics pipeline lands (stubbed, not faked).
 */
export async function getDashboardMetrics(): Promise<AdminDashboardMetrics> {
  const now = Date.now();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

  const [activeRow, dauRow, mauRow, growthRows] = await Promise.all([
    db.select({ value: count() }).from(subscriptions).where(eq(subscriptions.status, "active")),
    db
      .select({ value: count() })
      .from(users)
      .where(and(isNull(users.deletedAt), gte(users.lastActiveAt, dayAgo))),
    db
      .select({ value: count() })
      .from(users)
      .where(and(isNull(users.deletedAt), gte(users.lastActiveAt, thirtyDaysAgo))),
    db
      .select({
        date: sql<string>`to_char(date_trunc('day', ${users.createdAt}), 'YYYY-MM-DD')`,
        value: count(),
      })
      .from(users)
      .where(and(isNull(users.deletedAt), gte(users.createdAt, thirtyDaysAgo)))
      .groupBy(sql`date_trunc('day', ${users.createdAt})`)
      .orderBy(sql`date_trunc('day', ${users.createdAt})`),
  ]);

  return {
    mrrCents: 0,
    activeSubscribers: Number(activeRow[0]?.value ?? 0),
    dau: Number(dauRow[0]?.value ?? 0),
    mau: Number(mauRow[0]?.value ?? 0),
    churnRate: 0,
    subscriberGrowth: growthRows.map((row) => ({
      date: row.date,
      value: Number(row.value),
    })),
  };
}

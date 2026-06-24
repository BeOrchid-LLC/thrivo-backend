import { and, count, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { subscriptions, users } from "../../db/schema";

export type DashboardMetrics = {
  mrrCents: number;
  activeSubscribers: number;
  dau: number;
  mau: number;
  churnRate: number;
  subscriberGrowth: Array<{ date: string; value: number }>;
};

/** v1 dashboard aggregates — real counts where cheap; zeros until billing/activity pipelines land. */
export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);

  const [activeRow, mauRow, growthRows] = await Promise.all([
    db.select({ value: count() }).from(subscriptions).where(eq(subscriptions.status, "active")),
    db.select({ value: count() }).from(users).where(isNull(users.deletedAt)),
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
    dau: 0,
    mau: Number(mauRow[0]?.value ?? 0),
    churnRate: 0,
    subscriberGrowth: growthRows.map((row) => ({
      date: row.date,
      value: Number(row.value),
    })),
  };
}

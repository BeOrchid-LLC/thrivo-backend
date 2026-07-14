import { date, integer, pgTable, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { idPk } from "./_shared";

/**
 * One row per calendar day, appended/upserted by the nightly snapshot-mrr job.
 * `subscriptions` only holds current state, so this table is the only source
 * of MRR *history* — needed for the revenue trend chart and for "vs N days/
 * months ago" deltas (MRR/ARR/churn) on the admin overview page.
 */
export const mrrSnapshots = pgTable(
  "mrr_snapshots",
  {
    id: idPk(),
    snapshotDate: date("snapshot_date").notNull(),
    mrrCents: integer("mrr_cents").notNull(),
    activeMonthlyCount: integer("active_monthly_count").notNull(),
    activeAnnualCount: integer("active_annual_count").notNull(),
    premiumUserCount: integer("premium_user_count").notNull(),
    freeUserCount: integer("free_user_count").notNull(),
    churnedMrrCents: integer("churned_mrr_cents").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    snapshotDateUniq: uniqueIndex("mrr_snapshots_snapshot_date_uniq").on(t.snapshotDate),
  })
);

export type MrrSnapshotRow = typeof mrrSnapshots.$inferSelect;
export type NewMrrSnapshotRow = typeof mrrSnapshots.$inferInsert;

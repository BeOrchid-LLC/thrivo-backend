import { and, desc, gte, lte, sql } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { mrrSnapshots, type MrrSnapshotRow, type NewMrrSnapshotRow } from "../../db/schema";

export type MrrSnapshot = MrrSnapshotRow;

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** One row per calendar day — upsert on the unique `snapshot_date`. */
export async function upsertToday(
  input: NewMrrSnapshotRow,
  tx: Executor = db
): Promise<MrrSnapshot> {
  const { id: _id, createdAt: _c, ...set } = input;
  const [row] = await tx
    .insert(mrrSnapshots)
    .values(input)
    .onConflictDoUpdate({ target: mrrSnapshots.snapshotDate, set })
    .returning();
  return row;
}

export async function getLatest(tx: Executor = db): Promise<MrrSnapshot | null> {
  const [row] = await tx
    .select()
    .from(mrrSnapshots)
    .orderBy(desc(mrrSnapshots.snapshotDate))
    .limit(1);
  return row ?? null;
}

export async function getLatestOnOrBefore(
  date: Date,
  tx: Executor = db
): Promise<MrrSnapshot | null> {
  return getOnOrBefore(date, tx);
}

/**
 * Closest snapshot at or before `date` — used for "N days/months ago" deltas.
 * Looked up by proximity rather than an exact match since a snapshot may not
 * exist for the exact calendar day yet (rollout gaps, missed job runs).
 */
export async function getOnOrBefore(date: Date, tx: Executor = db): Promise<MrrSnapshot | null> {
  const [row] = await tx
    .select()
    .from(mrrSnapshots)
    .where(lte(mrrSnapshots.snapshotDate, toDateOnly(date)))
    .orderBy(desc(mrrSnapshots.snapshotDate))
    .limit(1);
  return row ?? null;
}

/** Sum of `churned_mrr_cents` across snapshot dates in [fromDateStr, toDateStr]
 *  — powers the revenue-trend card's monthly churned-MRR figure. */
export async function sumChurnedMrrBetween(
  fromDateStr: string,
  toDateStr: string,
  tx: Executor = db
): Promise<number> {
  const [row] = await tx
    .select({ total: sql<number>`coalesce(sum(${mrrSnapshots.churnedMrrCents}), 0)::int` })
    .from(mrrSnapshots)
    .where(
      and(gte(mrrSnapshots.snapshotDate, fromDateStr), lte(mrrSnapshots.snapshotDate, toDateStr))
    );
  return row?.total ?? 0;
}

/**
 * One point per month for the trailing `months` months (current month
 * included, capped at `now` instead of running past month-end) — powers the
 * revenue trend chart. A `null` snapshot means no history exists that far
 * back yet; the caller decides how to render that (e.g. omit the point).
 */
export async function getMonthlyTrend(
  months: number,
  now: Date,
  tx: Executor = db
): Promise<Array<{ monthEnd: string; snapshot: MrrSnapshot | null }>> {
  const points: Array<{ monthEnd: string; snapshot: MrrSnapshot | null }> = [];
  for (let i = months - 1; i >= 0; i--) {
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
    const boundary = lastDayOfMonth > now ? now : lastDayOfMonth;
    const snapshot = await getOnOrBefore(boundary, tx);
    points.push({ monthEnd: toDateOnly(boundary), snapshot });
  }
  return points;
}

/** One point per calendar month in an explicit analytics window. */
export async function getMonthlyTrendBetween(
  from: Date,
  to: Date,
  tx: Executor = db
): Promise<Array<{ monthEnd: string; snapshot: MrrSnapshot | null }>> {
  const points: Array<{ monthEnd: string; snapshot: MrrSnapshot | null }> = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  let count = 0;
  while (cursor <= end && count < 24) {
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const boundary = monthEnd > to ? to : monthEnd;
    points.push({ monthEnd: toDateOnly(boundary), snapshot: await getOnOrBefore(boundary, tx) });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    count += 1;
  }
  return points;
}

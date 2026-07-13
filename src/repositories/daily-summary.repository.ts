import { and, asc, eq, gt, gte, lte, sql } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import {
  dailySummaries,
  foodLogs,
  type DailySummaryRow,
  type NewDailySummaryRow,
} from "../../db/schema";

export type DailySummary = DailySummaryRow;

/**
 * Serialize concurrent recomputes for a single (user, day) rollup. Transaction-
 * scoped advisory lock — it auto-releases on commit/rollback, so this MUST be
 * called inside a `db.transaction` or it releases immediately and protects
 * nothing. Without it, two same-day writers each read an absolute total that
 * misses the other's uncommitted row and the rollup silently loses an entry.
 */
export async function lockForDay(
  userId: string,
  localDate: string,
  tx: Executor = db
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${userId}:${localDate}`}, 0))`
  );
}

/**
 * Backstop reconcile: recompute totals from the source `food_logs` for every
 * existing summary touched since `sinceDate` and heal any that drifted. Missing
 * summaries are intentionally left alone — the dashboard read falls back to a
 * live `food_logs` sum when a summary row is absent, so only stale *existing*
 * rows are a correctness bug. Returns the number of rows healed.
 */
export async function reconcileRecentSummaries(
  sinceDate: string,
  tx: Executor = db
): Promise<number> {
  const result = await tx.execute(sql`
    UPDATE ${dailySummaries} AS ds
    SET total_calories = agg.cal,
        total_protein_g = agg.pro,
        total_carbs_g = agg.carb,
        total_fat_g = agg.fat,
        updated_at = now()
    FROM (
      SELECT ${foodLogs.userId} AS user_id,
             ${foodLogs.localDate} AS local_date,
             coalesce(sum(${foodLogs.kcal}), 0)::int AS cal,
             coalesce(sum(${foodLogs.proteinG}), 0)::numeric AS pro,
             coalesce(sum(${foodLogs.carbsG}), 0)::numeric AS carb,
             coalesce(sum(${foodLogs.fatG}), 0)::numeric AS fat
      FROM ${foodLogs}
      WHERE ${foodLogs.localDate} >= ${sinceDate}
      GROUP BY ${foodLogs.userId}, ${foodLogs.localDate}
    ) AS agg
    WHERE ds.user_id = agg.user_id
      AND ds.local_date = agg.local_date
      AND (ds.total_calories <> agg.cal
        OR ds.total_protein_g <> agg.pro
        OR ds.total_carbs_g <> agg.carb
        OR ds.total_fat_g <> agg.fat)
  `);
  return result.rowCount ?? 0;
}

export async function getForDay(
  userId: string,
  localDate: string,
  tx: Executor = db
): Promise<DailySummary | null> {
  const [row] = await tx
    .select()
    .from(dailySummaries)
    .where(and(eq(dailySummaries.userId, userId), eq(dailySummaries.localDate, localDate)))
    .limit(1);
  return row ?? null;
}

/** Upsert the denormalized rollup for a day — keyed by unique(user_id, local_date). */
export async function upsertForDay(
  input: NewDailySummaryRow,
  tx: Executor = db
): Promise<DailySummary> {
  const { id: _id, createdAt: _c, ...set } = input;
  const [row] = await tx
    .insert(dailySummaries)
    .values(input)
    .onConflictDoUpdate({
      target: [dailySummaries.userId, dailySummaries.localDate],
      set,
    })
    .returning();
  return row;
}

/**
 * Average daily calorie total over the trailing `days` days — the admin
 * user-detail stat card. `null` (not 0) when there are zero rows in range,
 * so the UI can render "—" instead of a misleading "0 kcal avg".
 */
export async function getAvgDailyKcal(
  userId: string,
  days = 30,
  tx: Executor = db
): Promise<number | null> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [row] = await tx
    .select({ avg: sql<number | null>`avg(${dailySummaries.totalCalories})::int` })
    .from(dailySummaries)
    .where(and(eq(dailySummaries.userId, userId), gte(dailySummaries.localDate, since)));
  return row?.avg ?? null;
}

export async function listRange(
  userId: string,
  fromDate: string,
  toDate: string,
  tx: Executor = db
): Promise<DailySummary[]> {
  return tx
    .select()
    .from(dailySummaries)
    .where(
      and(
        eq(dailySummaries.userId, userId),
        gte(dailySummaries.localDate, fromDate),
        lte(dailySummaries.localDate, toDate)
      )
    )
    .orderBy(dailySummaries.localDate);
}

/**
 * R4-3 streak backfill — every distinct local day a user has a rollup for
 * (ascending). A `daily_summaries` row only ever exists because
 * `food.service.refreshDailySummary` ran after a real log write, so this is
 * exactly the "did the user log on local day D?" signal the streak is derived
 * from (D2 / ADR-0023's sibling decision, R4 doc).
 */
export async function listLocalDatesForUser(userId: string, tx: Executor = db): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ localDate: dailySummaries.localDate })
    .from(dailySummaries)
    .where(eq(dailySummaries.userId, userId))
    .orderBy(asc(dailySummaries.localDate));
  return rows.map((r) => r.localDate);
}

/**
 * R4-3 streak backfill — keyset page of distinct user ids with at least one
 * `daily_summaries` row (SYSTEM_DESIGN §373: keyset, never offset, even for a
 * one-off script). Uuid ordering is a stable total order, so `gt(userId,
 * after)` is a valid cursor.
 */
export async function listUserIdsWithSummariesAfter(
  afterUserId: string | null,
  limit: number,
  tx: Executor = db
): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ userId: dailySummaries.userId })
    .from(dailySummaries)
    .where(afterUserId ? gt(dailySummaries.userId, afterUserId) : undefined)
    .orderBy(asc(dailySummaries.userId))
    .limit(limit);
  return rows.map((r) => r.userId);
}

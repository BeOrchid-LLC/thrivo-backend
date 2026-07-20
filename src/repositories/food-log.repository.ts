import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { foodLogs, type FoodLogRow, type NewFoodLogRow } from "../../db/schema";
import type { HistorySort, MealTime } from "../../contracts/src/history-filters";
import { MEAL_TIME_WINDOWS } from "../../contracts/src/history-filters";

export type FoodLog = FoodLogRow;

export async function createLog(input: NewFoodLogRow, tx: Executor = db): Promise<FoodLog> {
  const [row] = await tx
    .insert(foodLogs)
    .values(input)
    // NULL keys are distinct, so key-less logs always insert. A repeated
    // (user, idempotency_key) — a retry or offline-queue replay — conflicts and
    // returns nothing; we then return the row that already landed.
    .onConflictDoNothing({ target: [foodLogs.userId, foodLogs.idempotencyKey] })
    .returning();
  if (row) return row;
  const [existing] = await tx
    .select()
    .from(foodLogs)
    .where(
      and(eq(foodLogs.userId, input.userId), eq(foodLogs.idempotencyKey, input.idempotencyKey!))
    )
    .limit(1);
  return existing;
}

/** The dominant diary query — served by the (user_id, local_date) index. */
export async function listLogsForDay(
  userId: string,
  localDate: string,
  tx: Executor = db
): Promise<FoodLog[]> {
  return tx
    .select()
    .from(foodLogs)
    .where(and(eq(foodLogs.userId, userId), eq(foodLogs.localDate, localDate)))
    .orderBy(desc(foodLogs.consumedAt), desc(foodLogs.loggedAt));
}

export interface FoodLogTotals {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/** Aggregate snapshots for a user-day; used as a fallback when daily_summaries is empty. */
export async function totalsForDay(
  userId: string,
  localDate: string,
  tx: Executor = db
): Promise<FoodLogTotals> {
  const [row] = await tx
    .select({
      calories: sql<number>`coalesce(sum(${foodLogs.kcal}), 0)::int`,
      proteinG: sql<string>`coalesce(sum(${foodLogs.proteinG}), 0)::text`,
      carbsG: sql<string>`coalesce(sum(${foodLogs.carbsG}), 0)::text`,
      fatG: sql<string>`coalesce(sum(${foodLogs.fatG}), 0)::text`,
    })
    .from(foodLogs)
    .where(and(eq(foodLogs.userId, userId), eq(foodLogs.localDate, localDate)));

  return {
    calories: row?.calories ?? 0,
    proteinG: Number(row?.proteinG ?? 0),
    carbsG: Number(row?.carbsG ?? 0),
    fatG: Number(row?.fatG ?? 0),
  };
}

/**
 * Distinct logged days in range, served by the (user_id, local_date) index —
 * backs the progress calendar (R5-2/I14), which only needs a Set of days and
 * previously loaded every full `food_logs` row in the grid to derive it.
 */
export async function listDistinctLocalDatesInRange(
  userId: string,
  fromDate: string,
  toDate: string,
  tx: Executor = db
): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ localDate: foodLogs.localDate })
    .from(foodLogs)
    .where(
      and(
        eq(foodLogs.userId, userId),
        gte(foodLogs.localDate, fromDate),
        lte(foodLogs.localDate, toDate)
      )
    );
  return rows.map((row) => row.localDate);
}

export async function listLogsByLocalDateRange(
  userId: string,
  fromDate: string,
  toDate: string,
  tx: Executor = db
): Promise<FoodLog[]> {
  return tx
    .select()
    .from(foodLogs)
    .where(
      and(
        eq(foodLogs.userId, userId),
        gte(foodLogs.localDate, fromDate),
        lte(foodLogs.localDate, toDate)
      )
    )
    .orderBy(desc(foodLogs.localDate), desc(foodLogs.consumedAt), desc(foodLogs.loggedAt));
}

export async function listLogsByRange(
  userId: string,
  fromLoggedAt: Date,
  toLoggedAt: Date,
  tx: Executor = db
): Promise<FoodLog[]> {
  return tx
    .select()
    .from(foodLogs)
    .where(
      and(
        eq(foodLogs.userId, userId),
        gte(foodLogs.loggedAt, fromLoggedAt),
        lte(foodLogs.loggedAt, toLoggedAt)
      )
    )
    .orderBy(asc(foodLogs.loggedAt));
}

export async function listRecentLogs(
  userId: string,
  limit = 20,
  tx: Executor = db
): Promise<FoodLog[]> {
  return tx
    .select()
    .from(foodLogs)
    .where(eq(foodLogs.userId, userId))
    .orderBy(desc(foodLogs.consumedAt), desc(foodLogs.loggedAt))
    .limit(limit);
}

export async function findLogForUser(
  userId: string,
  id: string,
  tx: Executor = db
): Promise<FoodLog | null> {
  const [row] = await tx
    .select()
    .from(foodLogs)
    .where(and(eq(foodLogs.userId, userId), eq(foodLogs.id, id)))
    .limit(1);
  return row ?? null;
}

// Composite PK (id, logged_at): both parts are required to address a single row.
export async function updateLog(
  id: string,
  loggedAt: Date,
  patch: Partial<NewFoodLogRow>,
  tx: Executor = db
): Promise<FoodLog | null> {
  const [row] = await tx
    .update(foodLogs)
    .set(patch)
    .where(and(eq(foodLogs.id, id), eq(foodLogs.loggedAt, loggedAt)))
    .returning();
  return row ?? null;
}

export async function updateLogForUser(
  userId: string,
  id: string,
  patch: Partial<NewFoodLogRow>,
  tx: Executor = db
): Promise<FoodLog | null> {
  const [row] = await tx
    .update(foodLogs)
    .set(patch)
    .where(and(eq(foodLogs.userId, userId), eq(foodLogs.id, id)))
    .returning();
  return row ?? null;
}

export async function deleteLog(id: string, loggedAt: Date, tx: Executor = db): Promise<void> {
  await tx.delete(foodLogs).where(and(eq(foodLogs.id, id), eq(foodLogs.loggedAt, loggedAt)));
}

export async function deleteLogForUser(
  userId: string,
  id: string,
  tx: Executor = db
): Promise<FoodLog | null> {
  const [row] = await tx
    .delete(foodLogs)
    .where(and(eq(foodLogs.userId, userId), eq(foodLogs.id, id)))
    .returning();
  return row ?? null;
}

/** Every log snapshot that still points at a given catalog item — the R1-5 backfill's repair set. */
export async function listByFoodItemId(foodItemId: string, tx: Executor = db): Promise<FoodLog[]> {
  return tx.select().from(foodLogs).where(eq(foodLogs.foodItemId, foodItemId));
}

/** Keyset page of diary rows missing a catalog link (food-log foodItemId backfill). */
export async function listNullFoodItemIdAfter(
  afterId: string | null,
  limit: number,
  tx: Executor = db
): Promise<FoodLog[]> {
  return tx
    .select()
    .from(foodLogs)
    .where(and(isNull(foodLogs.foodItemId), afterId ? gt(foodLogs.id, afterId) : undefined))
    .orderBy(asc(foodLogs.id))
    .limit(limit);
}

export interface FoodLogHistoryFilters {
  q?: string;
  mealTime?: MealTime;
  /** Pass only IDs that are confirmed favorites — the service resolves this from the favorites repo. */
  favoriteIds?: ReadonlySet<string>;
  favoritesOnly?: boolean;
  sort?: HistorySort;
  /** Opaque base64-encoded keyset cursor produced by `encodeFoodLogCursor`. */
  cursor?: string;
  limit?: number;
  /** User's IANA timezone (e.g. "Africa/Lagos") — required for meal-time filtering. */
  timezone?: string;
}

export interface FoodLogCursor {
  sort: HistorySort;
  localDate?: string;
  consumedAt?: string;
  kcal?: number;
  id: string;
}

export function encodeFoodLogCursor(row: FoodLogRow, sort: HistorySort): string {
  const payload: FoodLogCursor = {
    sort,
    localDate: row.localDate,
    consumedAt: row.consumedAt.toISOString(),
    kcal: row.kcal,
    id: row.id,
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function decodeFoodLogCursor(raw: string): FoodLogCursor | null {
  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as FoodLogCursor;
  } catch {
    return null;
  }
}

function mealTimeFilter(mealTime: MealTime, tz: string) {
  const { startHour, endHour } = MEAL_TIME_WINDOWS[mealTime];
  const hourExpr = sql<number>`extract(hour from ${foodLogs.consumedAt} at time zone ${sql.raw(`'${tz}'`)})`;
  if (startHour < endHour) {
    return and(gte(hourExpr, startHour), lt(hourExpr, endHour));
  }
  // Wraps midnight (e.g. night: 21–4)
  return or(gte(hourExpr, startHour), lt(hourExpr, endHour));
}

/**
 * Filtered, paginated food log query for history screens.
 * Served by the covering indexes added in migration 0032.
 */
export async function listLogsByLocalDateRangeFiltered(
  userId: string,
  fromDate: string,
  toDate: string,
  filters: FoodLogHistoryFilters = {},
  tx: Executor = db
): Promise<FoodLog[]> {
  const {
    q,
    mealTime,
    favoritesOnly,
    favoriteIds,
    sort = "newest",
    cursor,
    limit = 50,
    timezone = "UTC",
  } = filters;
  const parsed = cursor ? decodeFoodLogCursor(cursor) : null;

  const baseWhere = [
    eq(foodLogs.userId, userId),
    gte(foodLogs.localDate, fromDate),
    lte(foodLogs.localDate, toDate),
  ];

  if (q && q.trim().length > 0) {
    baseWhere.push(ilike(foodLogs.name, `%${q.trim()}%`));
  }

  if (mealTime) {
    const filter = mealTimeFilter(mealTime, timezone);
    if (filter) baseWhere.push(filter);
  }

  if (favoritesOnly && favoriteIds) {
    if (favoriteIds.size === 0) return [];
    baseWhere.push(inArray(foodLogs.foodItemId, [...favoriteIds]));
  }

  // Keyset cursor predicates
  if (parsed) {
    if (sort === "newest" && parsed.localDate && parsed.consumedAt) {
      const ld = parsed.localDate;
      const ca = parsed.consumedAt;
      const id = parsed.id;
      baseWhere.push(
        or(
          lt(foodLogs.localDate, ld),
          and(eq(foodLogs.localDate, ld), lt(foodLogs.consumedAt, new Date(ca))),
          and(
            eq(foodLogs.localDate, ld),
            eq(foodLogs.consumedAt, new Date(ca)),
            lt(foodLogs.id, id)
          )
        )!
      );
    } else if (sort === "oldest" && parsed.localDate && parsed.consumedAt) {
      const ld = parsed.localDate;
      const ca = parsed.consumedAt;
      const id = parsed.id;
      baseWhere.push(
        or(
          gt(foodLogs.localDate, ld),
          and(eq(foodLogs.localDate, ld), gt(foodLogs.consumedAt, new Date(ca))),
          and(
            eq(foodLogs.localDate, ld),
            eq(foodLogs.consumedAt, new Date(ca)),
            gt(foodLogs.id, id)
          )
        )!
      );
    } else if (sort === "highest" && parsed.kcal !== undefined) {
      baseWhere.push(
        or(
          lt(foodLogs.kcal, parsed.kcal),
          and(eq(foodLogs.kcal, parsed.kcal), lt(foodLogs.id, parsed.id))
        )!
      );
    } else if (sort === "lowest" && parsed.kcal !== undefined) {
      baseWhere.push(
        or(
          gt(foodLogs.kcal, parsed.kcal),
          and(eq(foodLogs.kcal, parsed.kcal), gt(foodLogs.id, parsed.id))
        )!
      );
    }
  }

  const orderBy =
    sort === "oldest"
      ? [asc(foodLogs.localDate), asc(foodLogs.consumedAt), asc(foodLogs.id)]
      : sort === "highest"
        ? [desc(foodLogs.kcal), desc(foodLogs.id)]
        : sort === "lowest"
          ? [asc(foodLogs.kcal), asc(foodLogs.id)]
          : [desc(foodLogs.localDate), desc(foodLogs.consumedAt), desc(foodLogs.id)];

  return tx
    .select()
    .from(foodLogs)
    .where(and(...baseWhere))
    .orderBy(...orderBy)
    .limit(limit + 1); // fetch +1 to detect if there's a next page
}

/** Total food-log count for a single user — the admin user-detail stat card. */
export async function countByUserId(userId: string, tx: Executor = db): Promise<number> {
  const [row] = await tx
    .select({ value: count() })
    .from(foodLogs)
    .where(eq(foodLogs.userId, userId));
  return Number(row?.value ?? 0);
}

/** Admin batch — food log counts keyed by user id. */
export async function countByUserIds(
  userIds: string[],
  tx: Executor = db
): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();

  const rows = await tx
    .select({ userId: foodLogs.userId, value: count() })
    .from(foodLogs)
    .where(inArray(foodLogs.userId, userIds))
    .groupBy(foodLogs.userId);

  return new Map(rows.map((row) => [row.userId, Number(row.value)]));
}

import { and, asc, desc, eq, gt, gte, lt, lte, or, sql } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { waterIntake, type NewWaterIntakeRow, type WaterIntakeRow } from "../../db/schema";
import type { HistorySort, MealTime } from "../../contracts/src/history-filters";
import { MEAL_TIME_WINDOWS } from "../../contracts/src/history-filters";

export type WaterIntake = WaterIntakeRow;

/** Total ml logged for a user-day — powers the daily ring rollup. */
export async function getDayTotal(
  userId: string,
  localDate: string,
  tx: Executor = db
): Promise<number> {
  const [row] = await tx
    .select({ total: sql<number>`coalesce(sum(${waterIntake.amountMl}), 0)::int` })
    .from(waterIntake)
    .where(and(eq(waterIntake.userId, userId), eq(waterIntake.localDate, localDate)));
  return row?.total ?? 0;
}

export async function addEntry(input: NewWaterIntakeRow, tx: Executor = db): Promise<WaterIntake> {
  const [row] = await tx
    .insert(waterIntake)
    .values(input)
    // Dedupe at-least-once writes: a repeated (user, idempotency_key) conflicts
    // and returns nothing, so we return the entry that already landed.
    .onConflictDoNothing({ target: [waterIntake.userId, waterIntake.idempotencyKey] })
    .returning();
  if (row) return row;
  const [existing] = await tx
    .select()
    .from(waterIntake)
    .where(
      and(
        eq(waterIntake.userId, input.userId),
        eq(waterIntake.idempotencyKey, input.idempotencyKey!)
      )
    )
    .limit(1);
  return existing;
}

export async function listEntriesForDay(
  userId: string,
  localDate: string,
  tx: Executor = db
): Promise<WaterIntake[]> {
  return tx
    .select()
    .from(waterIntake)
    .where(and(eq(waterIntake.userId, userId), eq(waterIntake.localDate, localDate)))
    .orderBy(desc(waterIntake.recordedAt));
}

export async function listEntriesByLocalDateRange(
  userId: string,
  fromDate: string,
  toDate: string,
  tx: Executor = db
): Promise<WaterIntake[]> {
  return tx
    .select()
    .from(waterIntake)
    .where(
      and(
        eq(waterIntake.userId, userId),
        gte(waterIntake.localDate, fromDate),
        lte(waterIntake.localDate, toDate)
      )
    )
    .orderBy(desc(waterIntake.localDate), desc(waterIntake.recordedAt));
}

export async function listTotalsRange(
  userId: string,
  fromDate: string,
  toDate: string,
  tx: Executor = db
): Promise<Array<{ day: string; totalMl: number }>> {
  const rows = await tx
    .select({
      day: waterIntake.localDate,
      totalMl: sql<number>`coalesce(sum(${waterIntake.amountMl}), 0)::int`,
    })
    .from(waterIntake)
    .where(
      and(
        eq(waterIntake.userId, userId),
        gte(waterIntake.localDate, fromDate),
        lte(waterIntake.localDate, toDate)
      )
    )
    .groupBy(waterIntake.localDate)
    .orderBy(asc(waterIntake.localDate));
  return rows.map((row) => ({ day: row.day, totalMl: row.totalMl }));
}

export async function updateEntryForUser(
  userId: string,
  id: string,
  updates: Partial<Pick<NewWaterIntakeRow, "amountMl" | "recordedAt">>,
  tx: Executor = db
): Promise<WaterIntake | null> {
  const [row] = await tx
    .update(waterIntake)
    .set(updates)
    .where(and(eq(waterIntake.userId, userId), eq(waterIntake.id, id)))
    .returning();
  return row ?? null;
}

export async function deleteEntryForUser(
  userId: string,
  id: string,
  tx: Executor = db
): Promise<WaterIntake | null> {
  const [row] = await tx
    .delete(waterIntake)
    .where(and(eq(waterIntake.userId, userId), eq(waterIntake.id, id)))
    .returning();
  return row ?? null;
}

export interface WaterHistoryFilters {
  mealTime?: MealTime;
  sort?: HistorySort;
  cursor?: string;
  limit?: number;
  timezone?: string;
}

export interface WaterCursor {
  sort: HistorySort;
  localDate?: string;
  recordedAt?: string;
  amountMl?: number;
  id: string;
}

export function encodeWaterCursor(row: WaterIntakeRow, sort: HistorySort): string {
  const payload: WaterCursor = {
    sort,
    localDate: row.localDate,
    recordedAt: row.recordedAt.toISOString(),
    amountMl: row.amountMl,
    id: row.id,
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function decodeWaterCursor(raw: string): WaterCursor | null {
  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as WaterCursor;
  } catch {
    return null;
  }
}

function mealTimeFilter(mealTime: MealTime, tz: string) {
  const { startHour, endHour } = MEAL_TIME_WINDOWS[mealTime];
  const hourExpr = sql<number>`extract(hour from ${waterIntake.recordedAt} at time zone ${sql.raw(`'${tz}'`)})`;
  if (startHour < endHour) {
    return and(gte(hourExpr, startHour), lt(hourExpr, endHour));
  }
  return or(gte(hourExpr, startHour), lt(hourExpr, endHour));
}

/**
 * Filtered, paginated water intake query for history screens.
 * Served by the covering indexes added in migration 0032.
 */
export async function listEntriesByLocalDateRangeFiltered(
  userId: string,
  fromDate: string,
  toDate: string,
  filters: WaterHistoryFilters = {},
  tx: Executor = db
): Promise<WaterIntake[]> {
  const { mealTime, sort = "newest", cursor, limit = 50, timezone = "UTC" } = filters;
  const parsed = cursor ? decodeWaterCursor(cursor) : null;

  const baseWhere = [
    eq(waterIntake.userId, userId),
    gte(waterIntake.localDate, fromDate),
    lte(waterIntake.localDate, toDate),
  ];

  if (mealTime) {
    const filter = mealTimeFilter(mealTime, timezone);
    if (filter) baseWhere.push(filter);
  }

  if (parsed) {
    if (sort === "newest" && parsed.localDate && parsed.recordedAt) {
      const ld = parsed.localDate;
      const ra = parsed.recordedAt;
      const id = parsed.id;
      baseWhere.push(
        or(
          lt(waterIntake.localDate, ld),
          and(eq(waterIntake.localDate, ld), lt(waterIntake.recordedAt, new Date(ra))),
          and(
            eq(waterIntake.localDate, ld),
            eq(waterIntake.recordedAt, new Date(ra)),
            lt(waterIntake.id, id)
          )
        )!
      );
    } else if (sort === "oldest" && parsed.localDate && parsed.recordedAt) {
      const ld = parsed.localDate;
      const ra = parsed.recordedAt;
      const id = parsed.id;
      baseWhere.push(
        or(
          gt(waterIntake.localDate, ld),
          and(eq(waterIntake.localDate, ld), gt(waterIntake.recordedAt, new Date(ra))),
          and(
            eq(waterIntake.localDate, ld),
            eq(waterIntake.recordedAt, new Date(ra)),
            gt(waterIntake.id, id)
          )
        )!
      );
    } else if (sort === "highest" && parsed.amountMl !== undefined) {
      baseWhere.push(
        or(
          lt(waterIntake.amountMl, parsed.amountMl),
          and(eq(waterIntake.amountMl, parsed.amountMl), lt(waterIntake.id, parsed.id))
        )!
      );
    } else if (sort === "lowest" && parsed.amountMl !== undefined) {
      baseWhere.push(
        or(
          gt(waterIntake.amountMl, parsed.amountMl),
          and(eq(waterIntake.amountMl, parsed.amountMl), gt(waterIntake.id, parsed.id))
        )!
      );
    }
  }

  const orderBy =
    sort === "oldest"
      ? [asc(waterIntake.localDate), asc(waterIntake.recordedAt), asc(waterIntake.id)]
      : sort === "highest"
        ? [desc(waterIntake.amountMl), desc(waterIntake.id)]
        : sort === "lowest"
          ? [asc(waterIntake.amountMl), asc(waterIntake.id)]
          : [desc(waterIntake.localDate), desc(waterIntake.recordedAt), desc(waterIntake.id)];

  return tx
    .select()
    .from(waterIntake)
    .where(and(...baseWhere))
    .orderBy(...orderBy)
    .limit(limit + 1);
}

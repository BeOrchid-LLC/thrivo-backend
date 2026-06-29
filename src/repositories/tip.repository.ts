import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { tips, type NewTipRow, type TipRow } from "../../db/schema";

export type Tip = TipRow;

/** Active tips in a stable order — the rotation set for the daily nudge. */
export async function listActive(tx: Executor = db): Promise<Tip[]> {
  return tx.select().from(tips).where(eq(tips.isActive, true)).orderBy(asc(tips.createdAt));
}

/** A tip explicitly pinned to a date by staff, if any (takes precedence). */
export async function getPinnedForDate(localDate: string, tx: Executor = db): Promise<Tip | null> {
  const [row] = await tx
    .select()
    .from(tips)
    .where(and(eq(tips.isActive, true), eq(tips.pinnedDate, localDate)))
    .limit(1);
  return row ?? null;
}

/** Batch resolve tips by id — used to attach tip bodies to a check-in list. */
export async function findByIds(ids: string[], tx: Executor = db): Promise<Map<string, Tip>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.select().from(tips).where(inArray(tips.id, ids));
  return new Map(rows.map((row) => [row.id, row]));
}

export async function countAll(tx: Executor = db): Promise<number> {
  const rows = await tx.select({ id: tips.id }).from(tips);
  return rows.length;
}

/** Seed/import helper — used by the starter-bank seeder. */
export async function insertMany(rows: NewTipRow[], tx: Executor = db): Promise<void> {
  if (rows.length === 0) return;
  await tx.insert(tips).values(rows);
}

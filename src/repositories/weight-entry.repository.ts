import { and, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { weightEntries, type NewWeightEntryRow, type WeightEntryRow } from "../../db/schema";

export type WeightEntry = WeightEntryRow;

export async function listForUser(
  userId: string,
  fromRecordedAt: Date,
  toRecordedAt: Date,
  tx: Executor = db
): Promise<WeightEntry[]> {
  return tx
    .select()
    .from(weightEntries)
    .where(
      and(
        eq(weightEntries.userId, userId),
        gte(weightEntries.recordedAt, fromRecordedAt),
        lte(weightEntries.recordedAt, toRecordedAt)
      )
    )
    .orderBy(desc(weightEntries.recordedAt));
}

export async function createEntry(
  input: NewWeightEntryRow,
  tx: Executor = db
): Promise<WeightEntry> {
  const [row] = await tx.insert(weightEntries).values(input).returning();
  return row;
}

export async function listForLocalDateRange(
  userId: string,
  fromDate: string,
  toDate: string,
  tx: Executor = db
): Promise<WeightEntry[]> {
  return tx
    .select()
    .from(weightEntries)
    .where(
      and(
        eq(weightEntries.userId, userId),
        gte(weightEntries.localDate, fromDate),
        lte(weightEntries.localDate, toDate)
      )
    )
    .orderBy(desc(weightEntries.localDate), desc(weightEntries.recordedAt));
}

export async function getLatestForUser(
  userId: string,
  tx: Executor = db
): Promise<WeightEntry | null> {
  const [row] = await tx
    .select()
    .from(weightEntries)
    .where(eq(weightEntries.userId, userId))
    .orderBy(desc(weightEntries.localDate), desc(weightEntries.recordedAt))
    .limit(1);
  return row ?? null;
}

export async function getLatestForDay(
  userId: string,
  localDate: string,
  tx: Executor = db
): Promise<WeightEntry | null> {
  const [row] = await tx
    .select()
    .from(weightEntries)
    .where(and(eq(weightEntries.userId, userId), eq(weightEntries.localDate, localDate)))
    .orderBy(desc(weightEntries.recordedAt))
    .limit(1);
  return row ?? null;
}

export async function updateEntryForUser(
  userId: string,
  id: string,
  patch: Partial<NewWeightEntryRow>,
  tx: Executor = db
): Promise<WeightEntry | null> {
  const [row] = await tx
    .update(weightEntries)
    .set(patch)
    .where(and(eq(weightEntries.userId, userId), eq(weightEntries.id, id)))
    .returning();
  return row ?? null;
}

export async function deleteEntry(id: string, userId: string, tx: Executor = db): Promise<void> {
  // userId is part of the predicate so a user can only ever delete their own row (no IDOR).
  await tx
    .delete(weightEntries)
    .where(and(eq(weightEntries.id, id), eq(weightEntries.userId, userId)));
}

export async function deleteEntryForUser(
  id: string,
  userId: string,
  tx: Executor = db
): Promise<WeightEntry | null> {
  const [row] = await tx
    .delete(weightEntries)
    .where(and(eq(weightEntries.id, id), eq(weightEntries.userId, userId)))
    .returning();
  return row ?? null;
}

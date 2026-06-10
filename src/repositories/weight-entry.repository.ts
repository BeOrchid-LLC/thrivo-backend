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

export async function deleteEntry(id: string, userId: string, tx: Executor = db): Promise<void> {
  // userId is part of the predicate so a user can only ever delete their own row (no IDOR).
  await tx
    .delete(weightEntries)
    .where(and(eq(weightEntries.id, id), eq(weightEntries.userId, userId)));
}

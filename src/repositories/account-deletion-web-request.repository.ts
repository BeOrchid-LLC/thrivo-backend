import { and, eq, lt } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { accountDeletionWebRequests } from "../../db/schema";

export async function findPendingByUser(userId: string, tx: Executor = db) {
  const [row] = await tx
    .select()
    .from(accountDeletionWebRequests)
    .where(
      and(
        eq(accountDeletionWebRequests.userId, userId),
        eq(accountDeletionWebRequests.status, "pending")
      )
    )
    .limit(1);
  return row ?? null;
}

export async function findByTokenHashForUpdate(tokenHash: string, tx: Executor) {
  const [row] = await tx
    .select()
    .from(accountDeletionWebRequests)
    .where(eq(accountDeletionWebRequests.tokenHash, tokenHash))
    .limit(1)
    .for("update");
  return row ?? null;
}

export async function create(
  input: { userId: string; tokenHash: string; expiresAt: Date },
  tx: Executor = db
) {
  const [row] = await tx.insert(accountDeletionWebRequests).values(input).returning();
  return row;
}

export async function markExpired(id: string, tx: Executor): Promise<void> {
  await tx
    .update(accountDeletionWebRequests)
    .set({ status: "expired" })
    .where(
      and(eq(accountDeletionWebRequests.id, id), eq(accountDeletionWebRequests.status, "pending"))
    );
}

export async function markConfirmed(
  id: string,
  erasureRequestId: string,
  confirmedAt: Date,
  tx: Executor
): Promise<void> {
  await tx
    .update(accountDeletionWebRequests)
    .set({ status: "confirmed", confirmedAt, erasureRequestId })
    .where(eq(accountDeletionWebRequests.id, id));
}

export async function purgeBefore(before: Date, tx: Executor = db): Promise<void> {
  await tx
    .delete(accountDeletionWebRequests)
    .where(lt(accountDeletionWebRequests.requestedAt, before));
}

import { and, asc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { accountErasureRequests, identityTombstones } from "../../db/schema";

export async function findOpenByUser(userId: string, tx: Executor = db) {
  const [row] = await tx
    .select()
    .from(accountErasureRequests)
    .where(
      and(
        eq(accountErasureRequests.userId, userId),
        or(
          eq(accountErasureRequests.status, "pending"),
          eq(accountErasureRequests.status, "processing"),
          eq(accountErasureRequests.status, "retryable")
        )
      )
    )
    .limit(1);
  return row ?? null;
}

export async function findById(id: string, tx: Executor = db) {
  const [row] = await tx
    .select()
    .from(accountErasureRequests)
    .where(eq(accountErasureRequests.id, id))
    .limit(1);
  return row ?? null;
}

export async function findOpenByAuthSubjectId(authSubjectId: string, tx: Executor = db) {
  const [row] = await tx
    .select()
    .from(accountErasureRequests)
    .where(
      and(
        eq(accountErasureRequests.authSubjectId, authSubjectId),
        or(
          eq(accountErasureRequests.status, "pending"),
          eq(accountErasureRequests.status, "processing"),
          eq(accountErasureRequests.status, "retryable")
        )
      )
    )
    .limit(1);
  return row ?? null;
}

export async function list(limit = 100, tx: Executor = db) {
  return tx
    .select()
    .from(accountErasureRequests)
    .orderBy(asc(accountErasureRequests.requestedAt))
    .limit(limit);
}

export async function create(
  input: {
    userId: string;
    authSubjectId: string;
    rcAppUserId: string;
  },
  tx: Executor = db
) {
  const [row] = await tx.insert(accountErasureRequests).values(input).returning();
  return row;
}

export async function claimNext(now = new Date(), tx: Executor = db) {
  const [row] = await tx
    .select()
    .from(accountErasureRequests)
    .where(
      and(
        lte(accountErasureRequests.nextAttemptAt, now),
        or(
          eq(accountErasureRequests.status, "pending"),
          eq(accountErasureRequests.status, "retryable")
        )
      )
    )
    .orderBy(asc(accountErasureRequests.nextAttemptAt))
    .limit(1);
  if (!row) return null;
  const [claimed] = await tx
    .update(accountErasureRequests)
    .set({ status: "processing", attempts: row.attempts + 1 })
    .where(
      and(eq(accountErasureRequests.id, row.id), eq(accountErasureRequests.status, row.status))
    )
    .returning();
  return claimed ?? null;
}

export async function markRetryable(
  id: string,
  errorCode: string,
  nextAttemptAt: Date,
  tx: Executor = db
) {
  await tx
    .update(accountErasureRequests)
    .set({ status: "retryable", lastErrorCode: errorCode, nextAttemptAt })
    .where(eq(accountErasureRequests.id, id));
}

export async function markFailed(id: string, errorCode: string, tx: Executor = db) {
  await tx
    .update(accountErasureRequests)
    .set({ status: "failed", lastErrorCode: errorCode })
    .where(eq(accountErasureRequests.id, id));
}

export async function markCompleted(id: string, proofDigest: string, tx: Executor = db) {
  await tx
    .update(accountErasureRequests)
    .set({
      status: "completed",
      completedAt: new Date(),
      proofDigest,
      authSubjectId: null,
      rcAppUserId: null,
      userId: null,
    })
    .where(eq(accountErasureRequests.id, id));
}

export async function retry(id: string, tx: Executor = db) {
  await tx
    .update(accountErasureRequests)
    .set({ status: "retryable", nextAttemptAt: new Date(), lastErrorCode: null })
    .where(eq(accountErasureRequests.id, id));
}

export async function addTombstone(
  kind: string,
  digest: string,
  expiresAt: Date | null,
  tx: Executor = db
) {
  await tx
    .insert(identityTombstones)
    .values({ kind, digest, expiresAt })
    .onConflictDoNothing({ target: [identityTombstones.kind, identityTombstones.digest] });
}

export async function hasActiveTombstone(
  kind: string,
  digest: string,
  now = new Date(),
  tx: Executor = db
) {
  const [row] = await tx
    .select({ id: identityTombstones.id })
    .from(identityTombstones)
    .where(
      and(
        eq(identityTombstones.kind, kind),
        eq(identityTombstones.digest, digest),
        or(isNull(identityTombstones.expiresAt), gte(identityTombstones.expiresAt, now))
      )
    )
    .limit(1);
  return Boolean(row);
}

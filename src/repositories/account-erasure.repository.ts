import { and, asc, count, eq, gte, isNull, lt, lte, or, sql } from "drizzle-orm";
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

export async function findAnyByUser(userId: string, tx: Executor = db) {
  const [row] = await tx
    .select()
    .from(accountErasureRequests)
    .where(eq(accountErasureRequests.userId, userId))
    .orderBy(asc(accountErasureRequests.requestedAt))
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

export async function findAnyByAuthSubjectId(authSubjectId: string, tx: Executor = db) {
  const [row] = await tx
    .select()
    .from(accountErasureRequests)
    .where(eq(accountErasureRequests.authSubjectId, authSubjectId))
    .orderBy(asc(accountErasureRequests.requestedAt))
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

export async function listPaged(
  input: { page: number; pageSize: number; status?: string },
  tx: Executor = db
) {
  const where = input.status ? eq(accountErasureRequests.status, input.status) : undefined;
  const [totalRow, rows] = await Promise.all([
    tx.select({ count: count() }).from(accountErasureRequests).where(where),
    tx
      .select()
      .from(accountErasureRequests)
      .where(where)
      .orderBy(asc(accountErasureRequests.requestedAt))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize),
  ]);
  return { rows, total: Number(totalRow[0]?.count ?? 0) };
}

export async function create(
  input: {
    userId: string;
    authSubjectId: string;
    rcAppUserId?: string | null;
  },
  tx: Executor = db
) {
  const [row] = await tx.insert(accountErasureRequests).values(input).returning();
  return row;
}

export async function claimNext(now = new Date(), tx: Executor = db) {
  const claim = async (executor: Executor) => {
    const [row] = await executor
      .select()
      .from(accountErasureRequests)
      .where(
        and(
          lte(accountErasureRequests.nextAttemptAt, now),
          or(
            eq(accountErasureRequests.status, "pending"),
            eq(accountErasureRequests.status, "retryable"),
            and(
              eq(accountErasureRequests.status, "processing"),
              lte(accountErasureRequests.leaseExpiresAt, now)
            )
          )
        )
      )
      .orderBy(asc(accountErasureRequests.nextAttemptAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!row) return null;
    const [claimed] = await executor
      .update(accountErasureRequests)
      .set({
        status: "processing",
        attempts: row.attempts + 1,
        processingStartedAt: now,
        leaseExpiresAt: new Date(now.getTime() + 10 * 60 * 1000),
      })
      .where(eq(accountErasureRequests.id, row.id))
      .returning();
    return claimed ?? null;
  };

  return tx === db ? db.transaction((transaction) => claim(transaction)) : claim(tx);
}

export async function markRetryable(
  id: string,
  errorCode: string,
  nextAttemptAt: Date,
  phase: string,
  consecutiveFailures: number,
  tx: Executor = db
) {
  await tx
    .update(accountErasureRequests)
    .set({
      status: "retryable",
      lastErrorCode: errorCode,
      nextAttemptAt,
      phase,
      consecutiveFailures,
      processingStartedAt: null,
      leaseExpiresAt: null,
    })
    .where(eq(accountErasureRequests.id, id));
}

export async function advancePhase(id: string, phase: string, tx: Executor = db) {
  await tx
    .update(accountErasureRequests)
    .set({
      phase,
      nextAttemptAt: new Date(),
      lastErrorCode: null,
      processingStartedAt: null,
      leaseExpiresAt: null,
    })
    .where(eq(accountErasureRequests.id, id));
}

export async function markFailed(id: string, errorCode: string, tx: Executor = db) {
  await tx
    .update(accountErasureRequests)
    .set({
      status: "failed",
      lastErrorCode: errorCode,
      processingStartedAt: null,
      leaseExpiresAt: null,
    })
    .where(eq(accountErasureRequests.id, id));
}

export async function markCompleted(id: string, proofDigest: string, tx: Executor = db) {
  await tx
    .update(accountErasureRequests)
    .set({
      status: "completed",
      completedAt: new Date(),
      proofDigest,
      phase: "finalization",
      processingStartedAt: null,
      leaseExpiresAt: null,
      authSubjectId: null,
      rcAppUserId: null,
      userId: null,
    })
    .where(eq(accountErasureRequests.id, id));
}

export async function retry(id: string, tx: Executor = db) {
  await tx
    .update(accountErasureRequests)
    .set({
      status: "retryable",
      nextAttemptAt: new Date(),
      lastErrorCode: null,
      consecutiveFailures: 0,
      processingStartedAt: null,
      leaseExpiresAt: null,
    })
    .where(eq(accountErasureRequests.id, id));
}

/** Remove completed erasure proofs after their 90-day audit-retention window. */
export async function purgeCompletedBefore(before: Date, tx: Executor = db): Promise<void> {
  await tx
    .delete(accountErasureRequests)
    .where(
      and(
        eq(accountErasureRequests.status, "completed"),
        lt(accountErasureRequests.completedAt, before)
      )
    );
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

export async function extendTombstone(
  kind: string,
  digest: string,
  expiresAt: Date,
  tx: Executor = db
) {
  await tx
    .insert(identityTombstones)
    .values({ kind, digest, expiresAt })
    .onConflictDoUpdate({
      target: [identityTombstones.kind, identityTombstones.digest],
      set: {
        expiresAt: sql`GREATEST(COALESCE(${identityTombstones.expiresAt}, ${expiresAt}), ${expiresAt})`,
      },
    });
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

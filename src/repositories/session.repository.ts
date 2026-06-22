import { and, eq, gt } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { session } from "../../db/schema";

export type SessionRow = typeof session.$inferSelect;

export type NewSession = {
  id: string;
  userId: string;
  /** SHA-256 of the opaque refresh token — the raw token is never stored. */
  tokenHash: string;
  expiresAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export async function create(input: NewSession, tx: Executor = db): Promise<void> {
  await tx.insert(session).values({
    id: input.id,
    token: input.tokenHash,
    userId: input.userId,
    expiresAt: input.expiresAt,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    // `session.updatedAt` has no DB default (only $onUpdate) — set it on insert.
    updatedAt: new Date(),
  });
}

/**
 * Atomically consume an unexpired refresh session by its token hash, returning
 * the row. A single `DELETE … RETURNING` makes refresh one-time-use: a replayed
 * or concurrent rotation finds zero rows, so there is no SELECT-then-DELETE race
 * (read-modify-write hazard, scar #12). Expired rows are left for cleanup.
 */
export async function consumeValid(
  tokenHash: string,
  tx: Executor = db
): Promise<SessionRow | null> {
  const [row] = await tx
    .delete(session)
    .where(and(eq(session.token, tokenHash), gt(session.expiresAt, new Date())))
    .returning();
  return row ?? null;
}

/** Revoke a single session (logout on this device). */
export async function deleteByTokenHash(tokenHash: string, tx: Executor = db): Promise<void> {
  await tx.delete(session).where(eq(session.token, tokenHash));
}

/** Revoke every session for a user (logout-all / account compromise). */
export async function deleteByUser(userId: string, tx: Executor = db): Promise<void> {
  await tx.delete(session).where(eq(session.userId, userId));
}

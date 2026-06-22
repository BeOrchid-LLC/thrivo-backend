import { and, eq, gt } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { verification } from "../../db/schema";

export type VerificationRow = typeof verification.$inferSelect;

export type NewVerification = {
  id: string;
  /** What the token authorizes, e.g. `magic-link:user@example.com`. */
  identifier: string;
  /** SHA-256 of the opaque token — the raw token is never stored. */
  valueHash: string;
  expiresAt: Date;
};

export async function create(input: NewVerification, tx: Executor = db): Promise<void> {
  await tx.insert(verification).values({
    id: input.id,
    identifier: input.identifier,
    value: input.valueHash,
    expiresAt: input.expiresAt,
  });
}

/**
 * Atomically consume an unexpired verification token by its hash, returning the
 * row (whose `identifier` carries the subject). Single `DELETE … RETURNING` makes
 * the token one-time-use: a replayed or concurrent verify finds zero rows, so a
 * link can never be redeemed twice (no SELECT-then-delete race). Expired rows are
 * left for cleanup.
 */
export async function consumeValid(
  valueHash: string,
  tx: Executor = db
): Promise<VerificationRow | null> {
  const [row] = await tx
    .delete(verification)
    .where(and(eq(verification.value, valueHash), gt(verification.expiresAt, new Date())))
    .returning();
  return row ?? null;
}

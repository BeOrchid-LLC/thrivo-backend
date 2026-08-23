import { eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { webhookIdentityOwnership } from "../../db/schema";

export async function record(
  input: { webhookEventId: string; identityDigest: string; resolvedUserId?: string | null },
  tx: Executor = db
) {
  const [row] = await tx
    .insert(webhookIdentityOwnership)
    .values(input)
    .onConflictDoUpdate({
      target: [webhookIdentityOwnership.webhookEventId, webhookIdentityOwnership.identityDigest],
      set: { resolvedUserId: input.resolvedUserId ?? null },
    })
    .returning();
  return row ?? null;
}

export async function recordMany(
  webhookEventId: string,
  identityDigests: string[],
  resolvedUserId?: string | null,
  tx: Executor = db
) {
  for (const identityDigest of [...new Set(identityDigests)]) {
    await record({ webhookEventId, identityDigest, resolvedUserId }, tx);
  }
}

export async function listDigestsByUser(userId: string, tx: Executor = db) {
  const rows = await tx
    .select({ identityDigest: webhookIdentityOwnership.identityDigest })
    .from(webhookIdentityOwnership)
    .where(eq(webhookIdentityOwnership.resolvedUserId, userId));
  return rows.map((row) => row.identityDigest);
}

export async function listEventIdsByDigests(digests: string[], tx: Executor = db) {
  if (digests.length === 0) return [] as string[];
  const rows = await tx
    .select({ webhookEventId: webhookIdentityOwnership.webhookEventId })
    .from(webhookIdentityOwnership)
    .where(inArray(webhookIdentityOwnership.identityDigest, [...new Set(digests)]));
  return rows.map((row) => row.webhookEventId);
}

export async function findByDigests(digests: string[], tx: Executor = db) {
  if (digests.length === 0) return [];
  return tx
    .select()
    .from(webhookIdentityOwnership)
    .where(inArray(webhookIdentityOwnership.identityDigest, [...new Set(digests)]));
}

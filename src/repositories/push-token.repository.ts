import { eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { pushTokens, type NewPushTokenRow, type PushTokenRow } from "../../db/schema";

export type PushToken = PushTokenRow;

/** Upsert on the token (unique) — re-registering a device refreshes its owner + activity. */
export async function register(input: NewPushTokenRow, tx: Executor = db): Promise<PushToken> {
  const [row] = await tx
    .insert(pushTokens)
    .values(input)
    .onConflictDoUpdate({
      target: pushTokens.expoPushToken,
      set: {
        userId: input.userId,
        platform: input.platform,
        isActive: true,
        lastUsedAt: new Date(),
      },
    })
    .returning();
  return row;
}

export async function listForUser(userId: string, tx: Executor = db): Promise<PushToken[]> {
  return tx.select().from(pushTokens).where(eq(pushTokens.userId, userId));
}

/** Deactivate tokens Expo reported as invalid (pruned lazily, not deleted). */
export async function pruneInvalid(tokens: string[], tx: Executor = db): Promise<void> {
  if (tokens.length === 0) return;
  await tx
    .update(pushTokens)
    .set({ isActive: false })
    .where(inArray(pushTokens.expoPushToken, tokens));
}

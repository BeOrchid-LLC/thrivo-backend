import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { account } from "../../db/schema";

export type AccountRow = typeof account.$inferSelect;

/** Find a linked external account by provider + provider-side account id. */
export async function findByProvider(
  providerId: string,
  accountId: string,
  tx: Executor = db
): Promise<AccountRow | null> {
  const [row] = await tx
    .select()
    .from(account)
    .where(and(eq(account.providerId, providerId), eq(account.accountId, accountId)))
    .limit(1);
  return row ?? null;
}

export type NewAccount = {
  id: string;
  providerId: string;
  accountId: string;
  userId: string;
  idToken?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  scope?: string | null;
};

export async function create(input: NewAccount, tx: Executor = db): Promise<void> {
  await tx.insert(account).values({
    id: input.id,
    providerId: input.providerId,
    accountId: input.accountId,
    userId: input.userId,
    idToken: input.idToken ?? null,
    accessToken: input.accessToken ?? null,
    refreshToken: input.refreshToken ?? null,
    scope: input.scope ?? null,
    // `account.updatedAt` has no DB default (only $onUpdate) — set it on insert.
    updatedAt: new Date(),
  });
}

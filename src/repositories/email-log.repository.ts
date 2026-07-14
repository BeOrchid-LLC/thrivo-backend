import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import {
  emailLogs,
  type EmailLogRow,
  type EmailStatus,
  type NewEmailLogRow,
} from "../../db/schema";

export type EmailLog = EmailLogRow;

export async function logSend(input: NewEmailLogRow, tx: Executor = db): Promise<EmailLog> {
  const [row] = await tx.insert(emailLogs).values(input).returning();
  return row;
}

export async function updateStatus(
  id: string,
  status: EmailStatus,
  fields: { providerMessageId?: string; error?: string } = {},
  tx: Executor = db
): Promise<void> {
  await tx
    .update(emailLogs)
    .set({ status, ...fields })
    .where(eq(emailLogs.id, id));
}

export async function listForUser(userId: string, tx: Executor = db): Promise<EmailLog[]> {
  return tx
    .select()
    .from(emailLogs)
    .where(eq(emailLogs.userId, userId))
    .orderBy(desc(emailLogs.createdAt));
}

/**
 * Dedupe guard for scheduled sends (e.g. weekly-review): true if `template`
 * was already logged for this user since `sinceDate`. A cron that reprocesses
 * the same user twice (manual retrigger, a timezone bucket matching more than
 * once around a DST transition) should not double-send.
 */
export async function hasRecentSend(
  userId: string,
  template: string,
  sinceDate: Date,
  tx: Executor = db
): Promise<boolean> {
  const [row] = await tx
    .select({ id: emailLogs.id })
    .from(emailLogs)
    .where(
      and(
        eq(emailLogs.userId, userId),
        eq(emailLogs.template, template),
        gte(emailLogs.createdAt, sinceDate)
      )
    )
    .limit(1);
  return row !== undefined;
}
/** Return the users with a recent send for one template in a single indexed query. */
export async function listRecentSends(
  userIds: string[],
  template: string,
  sinceDate: Date,
  tx: Executor = db
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();

  const rows = await tx
    .select({ userId: emailLogs.userId })
    .from(emailLogs)
    .where(
      and(
        inArray(emailLogs.userId, userIds),
        eq(emailLogs.template, template),
        gte(emailLogs.createdAt, sinceDate)
      )
    );

  return new Set(rows.flatMap((row) => (row.userId ? [row.userId] : [])));
}

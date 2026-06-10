import { desc, eq } from "drizzle-orm";
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

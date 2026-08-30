import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import {
  emailReplayPayloads,
  type EmailReplayPayloadRow,
  type NewEmailReplayPayloadRow,
} from "../../db/schema";

export async function create(
  input: NewEmailReplayPayloadRow,
  tx: Executor = db
): Promise<EmailReplayPayloadRow> {
  const [row] = await tx.insert(emailReplayPayloads).values(input).returning();
  return row;
}

export async function findByEmailLogId(
  emailLogId: string,
  tx: Executor = db
): Promise<EmailReplayPayloadRow | null> {
  const [row] = await tx
    .select()
    .from(emailReplayPayloads)
    .where(
      and(
        eq(emailReplayPayloads.emailLogId, emailLogId),
        gte(emailReplayPayloads.expiresAt, new Date())
      )
    )
    .limit(1);
  return row ?? null;
}

export async function purgeExpired(tx: Executor = db): Promise<number> {
  const rows = await tx
    .delete(emailReplayPayloads)
    .where(lte(emailReplayPayloads.expiresAt, new Date()))
    .returning({ id: emailReplayPayloads.id });
  return rows.length;
}

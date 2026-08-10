import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import {
  emailLogs,
  emailOutbox,
  type EmailOutboxRow,
  type NewEmailOutboxRow,
} from "../../db/schema";

export type EmailOutbox = EmailOutboxRow;

export async function create(input: NewEmailOutboxRow, tx: Executor = db): Promise<EmailOutbox> {
  const [row] = await tx.insert(emailOutbox).values(input).returning();
  return row;
}

export async function findByEmailLogId(
  emailLogId: string,
  tx: Executor = db
): Promise<EmailOutbox | null> {
  const [row] = await tx
    .select()
    .from(emailOutbox)
    .where(eq(emailOutbox.emailLogId, emailLogId))
    .limit(1);
  return row ?? null;
}

/** Claim pending or abandoned rows without blocking another relay instance. */
export async function claimDispatchBatch(limit: number): Promise<string[]> {
  return db.transaction(async (tx) => {
    const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
    const candidates = await tx.execute(sql`
      select id
      from ${emailOutbox}
      where expires_at > now()
        and (
          state = 'pending'
          or (state = 'dispatching' and dispatch_started_at < ${staleBefore})
          or (state = 'dispatched' and dispatched_at < ${staleBefore})
        )
      order by created_at
      for update skip locked
      limit ${limit}
    `);
    const ids = (candidates.rows as Array<{ id: string }>).map((row) => row.id);
    if (ids.length === 0) return [];
    const rows = await tx
      .update(emailOutbox)
      .set({ state: "dispatching", dispatchStartedAt: new Date(), dispatchedAt: null })
      .where(inArray(emailOutbox.id, ids))
      .returning({ emailLogId: emailOutbox.emailLogId });
    return rows.map((row) => row.emailLogId);
  });
}

export async function markDispatched(emailLogId: string, tx: Executor = db): Promise<void> {
  await tx
    .update(emailOutbox)
    .set({ state: "dispatched", dispatchedAt: new Date() })
    .where(and(eq(emailOutbox.emailLogId, emailLogId), eq(emailOutbox.state, "dispatching")));
}

export async function releaseForDispatch(emailLogId: string, tx: Executor = db): Promise<void> {
  await tx
    .update(emailOutbox)
    .set({ state: "pending", dispatchStartedAt: null })
    .where(eq(emailOutbox.emailLogId, emailLogId));
}

export async function complete(
  emailLogId: string,
  state: "completed" | "failed" | "expired",
  tx: Executor = db
): Promise<void> {
  await tx
    .update(emailOutbox)
    .set({
      state,
      completedAt: new Date(),
      payloadIv: null,
      payloadAuthTag: null,
      payloadCiphertext: null,
    })
    .where(eq(emailOutbox.emailLogId, emailLogId));
}

export async function expirePastDue(tx: Executor = db): Promise<number> {
  const rows = await tx
    .update(emailOutbox)
    .set({
      state: "expired",
      completedAt: new Date(),
      payloadIv: null,
      payloadAuthTag: null,
      payloadCiphertext: null,
    })
    .where(
      and(
        lt(emailOutbox.expiresAt, new Date()),
        or(
          eq(emailOutbox.state, "pending"),
          eq(emailOutbox.state, "dispatching"),
          eq(emailOutbox.state, "dispatched")
        )
      )
    )
    .returning({ emailLogId: emailOutbox.emailLogId });
  if (rows.length > 0) {
    await tx
      .update(emailLogs)
      .set({ status: "expired", failureCode: "expired_before_send", failedAt: new Date() })
      .where(
        inArray(
          emailLogs.id,
          rows.map((row) => row.emailLogId)
        )
      );
  }
  return rows.length;
}

import { and, eq, gt, lte } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { adminActionIdempotency, type AdminActionIdempotencyRow } from "../../db/schema";

const RETENTION_MS = 24 * 60 * 60 * 1000;

export type AdminActionReservation =
  | { created: true; row: AdminActionIdempotencyRow }
  | { created: false; row: AdminActionIdempotencyRow };

export async function reserve(
  action: string,
  targetId: string,
  idempotencyKey: string,
  tx: Executor = db
): Promise<AdminActionReservation> {
  const now = new Date();
  await tx.delete(adminActionIdempotency).where(lte(adminActionIdempotency.expiresAt, now));
  const [inserted] = await tx
    .insert(adminActionIdempotency)
    .values({
      action,
      targetId,
      idempotencyKey,
      response: null,
      responseMessage: "Request in progress",
      responseStatus: 202,
      expiresAt: new Date(now.getTime() + RETENTION_MS),
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) return { created: true, row: inserted };

  const [existing] = await tx
    .select()
    .from(adminActionIdempotency)
    .where(
      and(
        eq(adminActionIdempotency.action, action),
        eq(adminActionIdempotency.targetId, targetId),
        eq(adminActionIdempotency.idempotencyKey, idempotencyKey),
        gt(adminActionIdempotency.expiresAt, now)
      )
    )
    .limit(1);
  if (!existing) return reserve(action, targetId, idempotencyKey, tx);
  return { created: false, row: existing };
}

export async function complete(
  id: string,
  response: unknown,
  responseMessage: string,
  responseStatus: number,
  tx: Executor = db
): Promise<void> {
  await tx
    .update(adminActionIdempotency)
    .set({ response, responseMessage, responseStatus })
    .where(eq(adminActionIdempotency.id, id));
}

export async function release(id: string, tx: Executor = db): Promise<void> {
  await tx.delete(adminActionIdempotency).where(eq(adminActionIdempotency.id, id));
}

export async function purgeExpired(tx: Executor = db): Promise<number> {
  const rows = await tx
    .delete(adminActionIdempotency)
    .where(lte(adminActionIdempotency.expiresAt, new Date()))
    .returning({ id: adminActionIdempotency.id });
  return rows.length;
}

import { eq } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { emailCaptures, type EmailCaptureRow, type NewEmailCaptureRow } from "../../db/schema";

export type EmailCapture = EmailCaptureRow;

/** Idempotent on email (unique) — re-submitting a lead is a no-op. */
export async function capture(input: NewEmailCaptureRow, tx: Executor = db): Promise<EmailCapture> {
  const [row] = await tx
    .insert(emailCaptures)
    .values(input)
    .onConflictDoNothing({ target: emailCaptures.email })
    .returning();
  if (row) return row;
  const [existing] = await tx
    .select()
    .from(emailCaptures)
    .where(eq(emailCaptures.email, input.email))
    .limit(1);
  return existing;
}

/** Link a lead to a user when they sign up (reconciliation by email). */
export async function reconcileToUser(
  email: string,
  userId: string,
  tx: Executor = db
): Promise<void> {
  await tx
    .update(emailCaptures)
    .set({ reconciledUserId: userId })
    .where(eq(emailCaptures.email, email));
}

import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import {
  emailSuppressions,
  type EmailSuppressionReason,
  type EmailSuppressionRow,
} from "../../db/schema";

export async function findActive(
  email: string,
  tx: Executor = db
): Promise<EmailSuppressionRow | null> {
  const [row] = await tx
    .select()
    .from(emailSuppressions)
    .where(
      and(
        eq(emailSuppressions.email, email.toLowerCase()),
        eq(emailSuppressions.active, true),
        isNull(emailSuppressions.clearedAt)
      )
    )
    .limit(1);
  return row ?? null;
}

export async function suppress(
  email: string,
  reason: EmailSuppressionReason,
  providerEventId?: string,
  tx: Executor = db
): Promise<void> {
  await tx
    .insert(emailSuppressions)
    .values({ email: email.toLowerCase(), reason, providerEventId, active: true })
    .onConflictDoUpdate({
      target: emailSuppressions.email,
      set: {
        reason,
        providerEventId,
        active: true,
        suppressedAt: new Date(),
        clearedAt: null,
      },
    });
}

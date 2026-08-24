import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import {
  notificationDeliveries,
  type NotificationDeliveryRow,
  type NotificationDeliveryStatus,
} from "../../db/schema";

function deliveryKey(input: {
  userId: string;
  kind: string;
  localDate: string;
  scheduledTime: string;
}) {
  return and(
    eq(notificationDeliveries.userId, input.userId),
    eq(notificationDeliveries.kind, input.kind),
    eq(notificationDeliveries.localDate, input.localDate),
    eq(notificationDeliveries.scheduledTime, input.scheduledTime)
  );
}

export async function claim(
  input: {
    userId: string;
    kind: string;
    localDate: string;
    scheduledTime: string;
  },
  tx: Executor = db
): Promise<NotificationDeliveryRow | null> {
  const [inserted] = await tx
    .insert(notificationDeliveries)
    .values({ ...input, status: "queued" })
    .onConflictDoNothing({
      target: [
        notificationDeliveries.userId,
        notificationDeliveries.kind,
        notificationDeliveries.localDate,
        notificationDeliveries.scheduledTime,
      ],
    })
    .returning();
  if (inserted) return inserted;

  const [existing] = await tx
    .select()
    .from(notificationDeliveries)
    .where(deliveryKey(input))
    .limit(1);
  if (!existing || existing.status === "sent" || existing.status === "queued") return null;

  const [reclaimed] = await tx
    .update(notificationDeliveries)
    .set({ status: "queued", errorMessage: null })
    .where(
      and(eq(notificationDeliveries.id, existing.id), eq(notificationDeliveries.status, "failed"))
    )
    .returning();
  return reclaimed ?? null;
}

async function setStatus(
  id: string,
  status: NotificationDeliveryStatus,
  errorMessage: string | null,
  tx: Executor
) {
  await tx
    .update(notificationDeliveries)
    .set({ status, errorMessage })
    .where(eq(notificationDeliveries.id, id));
}

export async function markSent(id: string, tx: Executor = db) {
  await setStatus(id, "sent", null, tx);
}

export async function markFailed(id: string, error: unknown, tx: Executor = db) {
  const message = error instanceof Error ? error.message : String(error);
  await setStatus(id, "failed", message.slice(0, 500), tx);
}

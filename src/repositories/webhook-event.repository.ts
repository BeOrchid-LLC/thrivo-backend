import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import {
  webhookEvents,
  type NewWebhookEventRow,
  type WebhookEventRow,
  type WebhookProvider,
} from "../../db/schema";

export type WebhookEvent = WebhookEventRow;

/** Dedupe guard — true if this (provider, event_id) was already seen. */
export async function existsByProviderEvent(
  provider: WebhookProvider,
  eventId: string,
  tx: Executor = db
): Promise<boolean> {
  const [row] = await tx
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(and(eq(webhookEvents.provider, provider), eq(webhookEvents.eventId, eventId)))
    .limit(1);
  return row != null;
}

/** Fetch the ledger row for a (provider, event_id), if one exists. */
export async function findByProviderEvent(
  provider: WebhookProvider,
  eventId: string,
  tx: Executor = db
): Promise<WebhookEvent | null> {
  const [row] = await tx
    .select()
    .from(webhookEvents)
    .where(and(eq(webhookEvents.provider, provider), eq(webhookEvents.eventId, eventId)))
    .limit(1);
  return row ?? null;
}

/** Record an inbound event. onConflictDoNothing makes replays no-ops at the DB. */
export async function recordReceived(
  input: NewWebhookEventRow,
  tx: Executor = db
): Promise<WebhookEvent | null> {
  const [row] = await tx
    .insert(webhookEvents)
    .values(input)
    .onConflictDoNothing({ target: [webhookEvents.provider, webhookEvents.eventId] })
    .returning();
  return row ?? null;
}

export async function markProcessed(
  id: string,
  status: "processed" | "failed",
  tx: Executor = db
): Promise<void> {
  await tx
    .update(webhookEvents)
    .set({ status, processedAt: new Date() })
    .where(eq(webhookEvents.id, id));
}

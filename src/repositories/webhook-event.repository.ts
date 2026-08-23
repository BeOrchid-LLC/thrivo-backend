import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";
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
  status: "processed" | "failed" | "quarantined",
  tx: Executor = db
): Promise<void> {
  await tx
    .update(webhookEvents)
    .set({ status, processedAt: new Date() })
    .where(eq(webhookEvents.id, id));
}

export async function redactById(id: string, tx: Executor = db): Promise<void> {
  await tx
    .update(webhookEvents)
    .set({ payload: { redacted: true, reason: "account_erasure" } })
    .where(eq(webhookEvents.id, id));
}

export async function listReceived(
  provider: WebhookProvider,
  limit: number,
  tx: Executor = db
): Promise<WebhookEvent[]> {
  return tx
    .select()
    .from(webhookEvents)
    .where(and(eq(webhookEvents.provider, provider), eq(webhookEvents.status, "received")))
    .orderBy(asc(webhookEvents.receivedAt))
    .limit(limit);
}

/** Replace potentially identifying provider payloads with a minimal ledger marker. */
export async function redactForIdentifiers(
  identifiers: string[],
  tx: Executor = db
): Promise<void> {
  for (const identifier of [...new Set(identifiers.filter(Boolean))]) {
    await tx
      .update(webhookEvents)
      .set({ payload: { redacted: true, reason: "account_erasure" } })
      .where(
        and(
          eq(webhookEvents.provider, "revenuecat"),
          or(
            sql`${webhookEvents.payload}->'event'->>'app_user_id' = ${identifier}`,
            sql`${webhookEvents.payload}->'event'->>'original_app_user_id' = ${identifier}`,
            sql`${webhookEvents.payload}->'event'->'aliases' ? ${identifier}`
          )
        )
      );
  }
}

export async function redactByIds(ids: string[], tx: Executor = db): Promise<void> {
  if (ids.length === 0) return;
  await tx
    .update(webhookEvents)
    .set({ payload: { redacted: true, reason: "account_erasure" } })
    .where(inArray(webhookEvents.id, [...new Set(ids)]));
}

/** Retain the delivery ledger while removing raw provider payloads after 30 days. */
export async function redactExpiredPayloads(before: Date, tx: Executor = db): Promise<void> {
  await tx
    .update(webhookEvents)
    .set({ payload: { redacted: true, reason: "retention" } })
    .where(and(eq(webhookEvents.provider, "revenuecat"), lt(webhookEvents.receivedAt, before)));
}

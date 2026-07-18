import { and, count, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "../../db";
import {
  subscriptionEvents,
  users,
  webhookEvents,
  type SubscriptionEventType,
  type WebhookProvider,
  type WebhookStatus,
} from "../../db/schema";
import type {
  AdminSubscriptionEvent,
  AdminWebhookEventRow,
} from "../../contracts/src/admin-billing";
import type { AdminWebhookEventDetailResponse } from "../../contracts/src/admin-billing";
import { clampLimit, decodeCursor, encodeCursor } from "../lib/pagination";

function toEvent(r: {
  id: string;
  userId: string;
  userEmail: string | null;
  eventType: SubscriptionEventType;
  productId: string | null;
  occurredAt: Date;
  priceAmountCents: number | null;
  currency: string | null;
}): AdminSubscriptionEvent {
  return {
    id: r.id,
    userId: r.userId,
    userEmail: r.userEmail,
    eventType: r.eventType,
    productId: r.productId,
    occurredAt: r.occurredAt.toISOString(),
    priceAmountCents: r.priceAmountCents,
    currency: r.currency,
  };
}

type EventCursor = { occurredAt: string; id: string };

/** Keyset list of subscription funnel events, newest first, optional type filter. */
export async function listEventsPaged(params: {
  cursor?: string;
  limit?: number;
  eventType?: SubscriptionEventType;
}): Promise<{
  items: AdminSubscriptionEvent[];
  limit: number;
  total: number;
  nextCursor: string | null;
}> {
  const limit = clampLimit(params.limit, 20, 100);
  const typeWhere = params.eventType
    ? eq(subscriptionEvents.eventType, params.eventType)
    : undefined;
  const cursorWhere: SQL | undefined = params.cursor
    ? (() => {
        const c = decodeCursor<EventCursor>(params.cursor!);
        return sql`(${subscriptionEvents.occurredAt}, ${subscriptionEvents.id}) < (${c.occurredAt}::timestamptz, ${c.id})`;
      })()
    : undefined;

  const [rows, [{ value: total }]] = await Promise.all([
    db
      .select({
        id: subscriptionEvents.id,
        userId: subscriptionEvents.userId,
        userEmail: users.email,
        eventType: subscriptionEvents.eventType,
        productId: subscriptionEvents.productId,
        occurredAt: subscriptionEvents.occurredAt,
        priceAmountCents: subscriptionEvents.priceAmountCents,
        currency: subscriptionEvents.currency,
        occurredAtCursor: sql<string>`${subscriptionEvents.occurredAt}::text`,
      })
      .from(subscriptionEvents)
      .leftJoin(users, eq(users.id, subscriptionEvents.userId))
      .where(and(typeWhere, cursorWhere))
      .orderBy(desc(subscriptionEvents.occurredAt), desc(subscriptionEvents.id))
      .limit(limit),
    db.select({ value: count() }).from(subscriptionEvents).where(typeWhere),
  ]);

  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === limit && last
      ? encodeCursor({ occurredAt: last.occurredAtCursor, id: last.id } satisfies EventCursor)
      : null;

  return { items: rows.map(toEvent), limit, total: Number(total), nextCursor };
}

/** All funnel events for one user, newest first (bounded). */
export async function listEventsForUser(userId: string): Promise<AdminSubscriptionEvent[]> {
  const rows = await db
    .select({
      id: subscriptionEvents.id,
      userId: subscriptionEvents.userId,
      userEmail: users.email,
      eventType: subscriptionEvents.eventType,
      productId: subscriptionEvents.productId,
      occurredAt: subscriptionEvents.occurredAt,
      priceAmountCents: subscriptionEvents.priceAmountCents,
      currency: subscriptionEvents.currency,
    })
    .from(subscriptionEvents)
    .leftJoin(users, eq(users.id, subscriptionEvents.userId))
    .where(eq(subscriptionEvents.userId, userId))
    .orderBy(desc(subscriptionEvents.occurredAt), desc(subscriptionEvents.id));
  return rows.map(toEvent);
}

function toWebhookRow(r: {
  id: string;
  provider: WebhookProvider;
  eventId: string;
  status: WebhookStatus;
  receivedAt: Date;
  processedAt: Date | null;
}): AdminWebhookEventRow {
  return {
    id: r.id,
    provider: r.provider,
    eventId: r.eventId,
    status: r.status,
    receivedAt: r.receivedAt.toISOString(),
    processedAt: r.processedAt ? r.processedAt.toISOString() : null,
  };
}

type WebhookCursor = { receivedAt: string; id: string };

/** Keyset list of inbound webhook deliveries, newest first, optional filters. */
export async function listWebhooksPaged(params: {
  cursor?: string;
  limit?: number;
  provider?: WebhookProvider;
  status?: WebhookStatus;
}): Promise<{
  items: AdminWebhookEventRow[];
  limit: number;
  total: number;
  nextCursor: string | null;
}> {
  const limit = clampLimit(params.limit, 20, 100);
  const filters = [
    params.provider ? eq(webhookEvents.provider, params.provider) : undefined,
    params.status ? eq(webhookEvents.status, params.status) : undefined,
  ];
  const cursorWhere: SQL | undefined = params.cursor
    ? (() => {
        const c = decodeCursor<WebhookCursor>(params.cursor!);
        return sql`(${webhookEvents.receivedAt}, ${webhookEvents.id}) < (${c.receivedAt}::timestamptz, ${c.id})`;
      })()
    : undefined;

  const [rows, [{ value: total }]] = await Promise.all([
    db
      .select({
        id: webhookEvents.id,
        provider: webhookEvents.provider,
        eventId: webhookEvents.eventId,
        status: webhookEvents.status,
        receivedAt: webhookEvents.receivedAt,
        processedAt: webhookEvents.processedAt,
        receivedAtCursor: sql<string>`${webhookEvents.receivedAt}::text`,
      })
      .from(webhookEvents)
      .where(and(...filters, cursorWhere))
      .orderBy(desc(webhookEvents.receivedAt), desc(webhookEvents.id))
      .limit(limit),
    db
      .select({ value: count() })
      .from(webhookEvents)
      .where(and(...filters)),
  ]);

  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === limit && last
      ? encodeCursor({ receivedAt: last.receivedAtCursor, id: last.id } satisfies WebhookCursor)
      : null;

  return { items: rows.map(toWebhookRow), limit, total: Number(total), nextCursor };
}

/** Full webhook row incl. raw payload — admin-only surface. */
export async function findWebhookDetail(
  id: string
): Promise<AdminWebhookEventDetailResponse["webhook"] | null> {
  const [row] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, id)).limit(1);
  if (!row) return null;
  return { ...toWebhookRow(row), payload: row.payload };
}

import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import {
  pushCampaignRecipients,
  pushCampaigns,
  pushTokens,
  users,
  type NewPushCampaignRow,
  type PushCampaignRow,
  type PushRecipientStatus,
  type SubStatus,
} from "../../db/schema";
import type { AdminPushCampaignRow, AdminPushSegment } from "../../contracts/src/admin-push";
import { newId } from "../lib/ids";
import { clampLimit, decodeCursor, encodeCursor } from "../lib/pagination";

const RECIPIENT_LEASE_MS = 10 * 60 * 1000;

/** Map the admin subscription-status filter to the raw `users.subscriptionStatus`
 *  values it should match (the mirror stores RevenueCat-shaped states). */
const SUB_STATUS_MATCH: Record<string, SubStatus[]> = {
  active: ["active", "in_grace", "past_due"],
  trialing: ["trialing"],
  canceled: ["canceled"],
  expired: ["expired"],
};

/**
 * Build the WHERE conditions that resolve a segment against active push tokens.
 * Always scoped to non-deleted users and active tokens.
 */
function segmentConditions(segment: AdminPushSegment, now = new Date()): SQL[] {
  const conds: SQL[] = [isNull(users.deletedAt), eq(pushTokens.isActive, true)];
  if (segment.tier) conds.push(eq(users.tier, segment.tier));
  if (segment.subscriptionStatus) {
    if (segment.subscriptionStatus === "none") {
      conds.push(isNull(users.subscriptionStatus));
    } else {
      const matches = SUB_STATUS_MATCH[segment.subscriptionStatus] ?? [];
      conds.push(inArray(sql`${users.subscriptionStatus}`, matches));
    }
  }
  if (segment.lastActiveWithinDays) {
    const cutoff = new Date(now.getTime() - segment.lastActiveWithinDays * 24 * 60 * 60 * 1000);
    conds.push(gte(users.lastActiveAt, cutoff));
  }
  return conds;
}

/** Count matching users + active tokens for a segment (dry-run before send). */
export async function estimateAudience(
  segment: AdminPushSegment
): Promise<{ userCount: number; tokenCount: number }> {
  const where = and(...segmentConditions(segment));
  const [[{ users: userCount, tokens: tokenCount }]] = await Promise.all([
    db
      .select({ users: countDistinct(users.id), tokens: count(pushTokens.id) })
      .from(pushTokens)
      .innerJoin(users, eq(users.id, pushTokens.userId))
      .where(where),
  ]);
  return { userCount: Number(userCount), tokenCount: Number(tokenCount) };
}

/** Distinct active tokens (with owner) matching a segment — the send fan-out set. */
export async function resolveRecipients(
  segment: AdminPushSegment
): Promise<Array<{ userId: string; token: string }>> {
  const rows = await db
    .selectDistinct({ userId: pushTokens.userId, token: pushTokens.expoPushToken })
    .from(pushTokens)
    .innerJoin(users, eq(users.id, pushTokens.userId))
    .where(and(...segmentConditions(segment)));
  return rows;
}

function toRow(r: PushCampaignRow): AdminPushCampaignRow {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    deepLink: r.deepLink,
    status: r.status,
    segment: r.segment as AdminPushSegment,
    scheduledAt: r.scheduledAt ? r.scheduledAt.toISOString() : null,
    recipientCount: r.recipientCount,
    sentCount: r.sentCount,
    failedCount: r.failedCount,
    sentAt: r.sentAt ? r.sentAt.toISOString() : null,
    createdByAdminEmail: r.createdByAdminEmail,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function create(input: NewPushCampaignRow): Promise<AdminPushCampaignRow> {
  const [row] = await db.insert(pushCampaigns).values(input).returning();
  return toRow(row);
}

export async function findById(id: string, tx: Executor = db): Promise<PushCampaignRow | null> {
  const [row] = await tx.select().from(pushCampaigns).where(eq(pushCampaigns.id, id)).limit(1);
  return row ?? null;
}

export async function findRowById(id: string): Promise<AdminPushCampaignRow | null> {
  const row = await findById(id);
  return row ? toRow(row) : null;
}

/** Atomically claims a draft/scheduled campaign for one manual dispatch. */
export async function claimForManualSend(id: string): Promise<PushCampaignRow | null> {
  const [row] = await db
    .update(pushCampaigns)
    .set({ status: "sending" })
    .where(and(eq(pushCampaigns.id, id), inArray(pushCampaigns.status, ["draft", "scheduled"])))
    .returning();
  return row ?? null;
}

/** Put a campaign back into its pre-dispatch state when queueing failed. */
export async function restoreAfterEnqueueFailure(
  id: string,
  status: "draft" | "scheduled"
): Promise<void> {
  await db
    .update(pushCampaigns)
    .set({ status })
    .where(and(eq(pushCampaigns.id, id), eq(pushCampaigns.status, "sending")));
}

export async function updateDraft(
  id: string,
  patch: Partial<
    Pick<NewPushCampaignRow, "title" | "body" | "deepLink" | "segment" | "scheduledAt">
  >,
  tx: Executor = db
): Promise<PushCampaignRow | null> {
  const [row] = await tx
    .update(pushCampaigns)
    .set({ ...patch, status: patch.scheduledAt ? "scheduled" : "draft" })
    .where(and(eq(pushCampaigns.id, id), eq(pushCampaigns.status, "draft")))
    .returning();
  return row ?? null;
}

export async function cancelScheduled(
  id: string,
  tx: Executor = db
): Promise<PushCampaignRow | null> {
  const [row] = await tx
    .update(pushCampaigns)
    .set({ status: "canceled" })
    .where(and(eq(pushCampaigns.id, id), eq(pushCampaigns.status, "scheduled")))
    .returning();
  return row ?? null;
}

export async function claimDueScheduled(now = new Date(), limit = 50): Promise<PushCampaignRow[]> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(pushCampaigns)
      .where(
        and(eq(pushCampaigns.status, "scheduled"), sql`${pushCampaigns.scheduledAt} <= ${now}`)
      )
      .orderBy(pushCampaigns.scheduledAt, pushCampaigns.id)
      .limit(limit)
      .for("update", { skipLocked: true });
    if (rows.length === 0) return [];
    await tx
      .update(pushCampaigns)
      .set({ status: "sending" })
      .where(
        inArray(
          pushCampaigns.id,
          rows.map((row) => row.id)
        )
      );
    return rows.map((row) => ({ ...row, status: "sending" as const }));
  });
}

type CampaignCursor = { createdAt: string; id: string };

export async function listPaged(params: { cursor?: string; limit?: number }): Promise<{
  items: AdminPushCampaignRow[];
  limit: number;
  total: number;
  nextCursor: string | null;
}> {
  const limit = clampLimit(params.limit, 20, 100);
  const cursorWhere: SQL | undefined = params.cursor
    ? (() => {
        const c = decodeCursor<CampaignCursor>(params.cursor!);
        return sql`(${pushCampaigns.createdAt}, ${pushCampaigns.id}) < (${c.createdAt}::timestamptz, ${c.id})`;
      })()
    : undefined;

  const [rows, [{ value: total }]] = await Promise.all([
    db
      .select({
        row: pushCampaigns,
        createdAtCursor: sql<string>`${pushCampaigns.createdAt}::text`,
      })
      .from(pushCampaigns)
      .where(cursorWhere)
      .orderBy(desc(pushCampaigns.createdAt), desc(pushCampaigns.id))
      .limit(limit),
    db.select({ value: count() }).from(pushCampaigns),
  ]);

  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === limit && last
      ? encodeCursor({ createdAt: last.createdAtCursor, id: last.row.id } satisfies CampaignCursor)
      : null;

  return { items: rows.map((r) => toRow(r.row)), limit, total: Number(total), nextCursor };
}

// --- Send-path writes (used by the worker) ---

export async function setStatus(
  id: string,
  status: PushCampaignRow["status"],
  fields: Partial<
    Pick<NewPushCampaignRow, "recipientCount" | "sentCount" | "failedCount" | "sentAt">
  > = {},
  tx: Executor = db
): Promise<void> {
  await tx
    .update(pushCampaigns)
    .set({ status, ...fields })
    .where(eq(pushCampaigns.id, id));
}

export async function insertRecipients(
  campaignId: string,
  recipients: Array<{ userId: string; token: string }>,
  tx: Executor = db
): Promise<void> {
  if (recipients.length === 0) return;
  await tx
    .insert(pushCampaignRecipients)
    .values(recipients.map((r) => ({ campaignId, userId: r.userId, pushToken: r.token })))
    .onConflictDoNothing();
}

/**
 * Atomically leases one Expo-sized batch. A duplicate or redelivered campaign
 * job cannot claim rows already being sent by another worker. A stale lease is
 * eligible after the bounded window so a crashed worker does not strand a
 * campaign forever; the processing token prevents the old worker from later
 * marking a reclaimed row.
 */
export async function claimQueuedRecipients(
  campaignId: string,
  limit: number
): Promise<Array<{ id: string; userId: string; token: string; processingToken: string }>> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const leaseCutoff = new Date(now.getTime() - RECIPIENT_LEASE_MS);
    const rows = await tx
      .select({
        id: pushCampaignRecipients.id,
        userId: pushCampaignRecipients.userId,
        token: pushCampaignRecipients.pushToken,
      })
      .from(pushCampaignRecipients)
      .where(
        and(
          eq(pushCampaignRecipients.campaignId, campaignId),
          or(
            eq(pushCampaignRecipients.status, "queued"),
            and(
              eq(pushCampaignRecipients.status, "processing"),
              or(
                isNull(pushCampaignRecipients.processingAt),
                lt(pushCampaignRecipients.processingAt, leaseCutoff)
              )
            )
          )
        )
      )
      .orderBy(pushCampaignRecipients.createdAt, pushCampaignRecipients.id)
      .limit(limit)
      .for("update", { skipLocked: true });
    if (rows.length === 0) return [];

    const processingToken = newId();
    await tx
      .update(pushCampaignRecipients)
      .set({ status: "processing", processingAt: now, processingToken, error: null })
      .where(
        inArray(
          pushCampaignRecipients.id,
          rows.map((row) => row.id)
        )
      );
    return rows.map((row) => ({ ...row, processingToken }));
  });
}

export async function recipientCounts(campaignId: string, tx: Executor = db) {
  const rows = await tx
    .select({ status: pushCampaignRecipients.status, count: count() })
    .from(pushCampaignRecipients)
    .where(eq(pushCampaignRecipients.campaignId, campaignId))
    .groupBy(pushCampaignRecipients.status);
  return {
    recipientCount: rows.reduce((total, row) => total + Number(row.count), 0),
    sentCount: Number(rows.find((row) => row.status === "sent")?.count ?? 0),
    failedCount: Number(rows.find((row) => row.status === "failed")?.count ?? 0),
    queuedCount: Number(rows.find((row) => row.status === "queued")?.count ?? 0),
    processingCount: Number(rows.find((row) => row.status === "processing")?.count ?? 0),
  };
}

export async function markRecipients(
  campaignId: string,
  recipientIds: string[],
  status: PushRecipientStatus,
  error: string | null = null,
  processingToken?: string,
  tx: Executor = db
): Promise<void> {
  if (recipientIds.length === 0) return;
  await tx
    .update(pushCampaignRecipients)
    .set({
      status,
      error,
      processingAt: status === "processing" ? new Date() : null,
      processingToken: status === "processing" ? (processingToken ?? null) : null,
    })
    .where(
      and(
        eq(pushCampaignRecipients.campaignId, campaignId),
        inArray(pushCampaignRecipients.id, recipientIds),
        ...(processingToken ? [eq(pushCampaignRecipients.processingToken, processingToken)] : [])
      )
    );
}

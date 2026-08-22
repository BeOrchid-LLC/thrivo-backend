import {
  and,
  count,
  eq,
  getTableColumns,
  ilike,
  isNull,
  isNotNull,
  or,
  desc,
  sql,
} from "drizzle-orm";
import { db } from "../../db";
import { users } from "../../db/schema";
import * as foodLogRepo from "./food-log.repository";
import * as streakRepo from "./streak.repository";
import * as subscriptionRepo from "./subscription.repository";
import * as subscriptionEventRepo from "./subscription-event.repository";
import * as weightEntryRepo from "./weight-entry.repository";
import * as checkInRepo from "./check-in.repository";
import * as dailySummaryRepo from "./daily-summary.repository";
import * as userDeviceRepo from "./user-device.repository";
import * as userEventRepo from "./user-event.repository";
import * as adminAuditLogRepo from "./admin-audit-log.repository";
import type { AuditActor } from "./admin-audit-log.repository";
import type { AdminUser, AdminUserDetail } from "../../contracts/src/admin";
import {
  toAdminSubscription,
  toAdminUserDetail,
  type AdminUserAggregates,
  type AdminUserDetailExtras,
} from "../mappers/admin-user.mapper";
import { clampLimit, decodeCursor, encodeCursor } from "../lib/pagination";

export type AdminListParams = {
  /** Opaque cursor from a previous page's `nextCursor` — omit for the first page. */
  cursor?: string;
  limit?: number;
  search?: string;
  /** "active" | "suspended" | "deleted" | "all" */
  status?: string;
};

export type AdminListResult = {
  items: AdminUser[];
  pagination: {
    limit: number;
    total: number;
    /** Opaque cursor for the next page, or null when this page is the last one. */
    nextCursor: string | null;
  };
};

type UserCursor = { createdAt: string; id: string };

function emptyAggregates(): AdminUserAggregates {
  return { totalFoodLogs: 0, currentStreakDays: 0, subscription: null };
}

async function loadAggregatesForUsers(
  userIds: string[]
): Promise<Map<string, AdminUserAggregates>> {
  const map = new Map<string, AdminUserAggregates>();
  if (userIds.length === 0) return map;

  const [logCounts, streakRows, subscriptionRows] = await Promise.all([
    foodLogRepo.countByUserIds(userIds),
    streakRepo.getByUserIds(userIds),
    subscriptionRepo.getByUserIds(userIds),
  ]);

  const streakByUser = new Map(streakRows.map((row) => [row.userId, row]));
  const subscriptionByUser = new Map(subscriptionRows.map((row) => [row.userId, row]));

  for (const userId of userIds) {
    const subscriptionRow = subscriptionByUser.get(userId);
    map.set(userId, {
      totalFoodLogs: logCounts.get(userId) ?? 0,
      currentStreakDays: streakByUser.get(userId)?.currentStreak ?? 0,
      subscription: subscriptionRow ? toAdminSubscription(subscriptionRow) : null,
    });
  }

  return map;
}

function extractTrigger(metadata: unknown): string | null {
  if (metadata && typeof metadata === "object" && "trigger" in metadata) {
    const trigger = (metadata as { trigger: unknown }).trigger;
    return typeof trigger === "string" ? trigger : null;
  }
  return null;
}

/**
 * Single-user-only extras for the admin user-detail page — device info,
 * conversion trigger, weight/check-in counts, avg kcal, and the extended
 * subscription fields derived from `subscription_events` history. NOT called
 * from `listUsers`: these queries are only worth paying for on the one-user
 * detail page, not fanned out across a whole page of the users list.
 */
async function findDetailExtras(userId: string): Promise<AdminUserDetailExtras> {
  const subscriptionRow = await subscriptionRepo.getByUser(userId);

  const [
    totalWeightLogs,
    totalCheckIns,
    avgDailyKcal,
    revenueToDateCents,
    revenueTotalsByCurrency,
    subscriptionEvents,
    device,
    upgradePrompt,
  ] = await Promise.all([
    weightEntryRepo.countByUserId(userId),
    checkInRepo.countByUserId(userId),
    dailySummaryRepo.getAvgDailyKcal(userId),
    subscriptionEventRepo.sumPriceAmountCentsByUser(userId),
    subscriptionEventRepo.sumPriceAmountCentsByCurrencyByUser(userId),
    subscriptionEventRepo.listByUser(userId),
    userDeviceRepo.getByUser(userId),
    userEventRepo.findLatestByType(userId, "upgrade_prompt_shown"),
  ]);

  const trialStarted = subscriptionEvents.find((e) => e.eventType === "trial_started") ?? null;
  const trialConverted = subscriptionEvents.find((e) => e.eventType === "trial_converted") ?? null;
  const firstPriced = subscriptionEvents.find((e) => e.priceAmountCents !== null) ?? null;

  return {
    device: device
      ? { platform: device.platform, osVersion: device.osVersion, deviceModel: device.deviceModel }
      : null,
    convertedViaTrigger: extractTrigger(upgradePrompt?.metadata),
    totalWeightLogs,
    totalCheckIns,
    avgDailyKcal,
    subscriptionExtras: subscriptionRow
      ? {
          trialStartedAt: trialStarted?.occurredAt.toISOString() ?? null,
          trialConvertedAt: trialConverted?.occurredAt.toISOString() ?? null,
          firstChargeAt: firstPriced?.occurredAt.toISOString() ?? null,
          firstChargeAmountCents: firstPriced?.priceAmountCents ?? null,
          revenueToDateCents,
          revenueTotalsByCurrency,
          firstCharge:
            firstPriced?.priceAmountCents !== null &&
            firstPriced?.priceAmountCents !== undefined &&
            firstPriced.currency
              ? {
                  amountCents: firstPriced.priceAmountCents,
                  currency: firstPriced.currency.toUpperCase(),
                }
              : null,
          lastSyncedAt: subscriptionRow.lastSyncedAt?.toISOString() ?? null,
          lastWebhookAt: subscriptionRow.lastWebhookAt?.toISOString() ?? null,
          stripeCustomerId: null,
          rcAppUserId: subscriptionRow.rcAppUserId,
        }
      : null,
  };
}

function buildStatusWhere(status: string | undefined) {
  if (!status || status === "all") return undefined;
  if (status === "deleted") return isNotNull(users.deletedAt);
  if (status === "suspended")
    return and(isNull(users.deletedAt), eq(users.accountStatus, "dormant"));
  return and(isNull(users.deletedAt), isNotNull(users.accountStatus));
}

/**
 * `created_at` is `timestamptz` (microsecond precision in Postgres). A cursor
 * built from a JS `Date` (millisecond precision only, via `.toISOString()`)
 * would be a strictly *smaller* bound than the row it came from whenever that
 * row's true value has a sub-millisecond component — and since the cursor is
 * a strict `<` upper bound, that silently skips any row whose true value
 * falls in the truncated gap (most likely when two rows land in the same
 * millisecond: concurrent signups, bulk imports). So the cursor carries the
 * column's raw `::text` cast instead of a `Date` — full precision, no round
 * trip through a lossy type — compared back against the bare `created_at`
 * column so the `users_created_at_id_idx` index stays usable (only the cursor
 * *value* is cast; the indexed column itself is never wrapped in a function).
 */
function buildCursorWhere(cursor: UserCursor) {
  return sql`(${users.createdAt}, ${users.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id})`;
}

export async function listUsers(params: AdminListParams): Promise<AdminListResult> {
  const { search, status } = params;
  const limit = clampLimit(params.limit, 20, 100);

  const searchWhere = search
    ? or(ilike(users.email, `%${search}%`), ilike(users.name, `%${search}%`))
    : undefined;
  const statusWhere = buildStatusWhere(status);
  const filterWhere = and(searchWhere, statusWhere);
  const cursorWhere = params.cursor
    ? buildCursorWhere(decodeCursor<UserCursor>(params.cursor))
    : undefined;

  const [rows, [{ value: total }]] = await Promise.all([
    db
      .select({ ...getTableColumns(users), createdAtCursor: sql<string>`${users.createdAt}::text` })
      .from(users)
      .where(and(filterWhere, cursorWhere))
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(limit),
    db.select({ value: count() }).from(users).where(filterWhere),
  ]);

  const userIds = rows.map((row) => row.id);
  const aggregatesByUser = await loadAggregatesForUsers(userIds);

  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === limit && last
      ? encodeCursor({ createdAt: last.createdAtCursor, id: last.id } satisfies UserCursor)
      : null;

  return {
    items: rows.map((row) =>
      toAdminUserDetail(row, aggregatesByUser.get(row.id) ?? emptyAggregates())
    ),
    pagination: {
      limit,
      total: Number(total),
      nextCursor,
    },
  };
}

export async function findById(id: string): Promise<AdminUserDetail | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!row) return null;

  const [aggregatesByUser, extras] = await Promise.all([
    loadAggregatesForUsers([row.id]),
    findDetailExtras(row.id),
  ]);
  return toAdminUserDetail(row, aggregatesByUser.get(row.id) ?? emptyAggregates(), extras);
}

/**
 * Permanent hard delete — removes the `users` profile and its linked `auth_user`
 * identity in one transaction. Deleting `auth_user` cascades to `session` and
 * `account` via FK, which immediately invalidates any live refresh tokens.
 * Writes the `admin_audit_log` row in the same transaction (before-snapshot of
 * the full user row) so a rolled-back delete leaves no orphan audit entry and
 * vice-versa. Returns true if the user existed and was deleted.
 */
export async function hardDeleteUser(id: string, audit: AuditActor): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(users).where(eq(users.id, id)).limit(1);
    if (!row) return false;

    // Clerk owns the auth identity — caller should separately delete the Clerk
    // user via the Clerk API if needed. Domain row is deleted here only.
    await tx.delete(users).where(eq(users.id, id));

    await adminAuditLogRepo.append(
      {
        actorAdminEmail: audit.actorAdminEmail,
        action: "user.hard_delete",
        targetType: "user",
        targetId: id,
        before: row,
        requestId: audit.requestId,
        ip: audit.ip,
      },
      tx
    );
    return true;
  });
}

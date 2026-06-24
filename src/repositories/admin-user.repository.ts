import { and, count, eq, ilike, isNull, isNotNull, or, desc } from "drizzle-orm";
import { db } from "../../db";
import { users } from "../../db/schema";
import * as authIdentityRepo from "./auth-identity.repository";
import * as foodLogRepo from "./food-log.repository";
import * as streakRepo from "./streak.repository";
import * as subscriptionRepo from "./subscription.repository";
import type { AdminUser, AdminUserDetail } from "../../contracts/src/admin";
import {
  toAdminSubscription,
  toAdminUserDetail,
  type AdminUserAggregates,
} from "../mappers/admin-user.mapper";

export type AdminListParams = {
  page: number;
  pageSize: number;
  search?: string;
  /** "active" | "suspended" | "deleted" | "all" */
  status?: string;
};

export type AdminListResult = {
  items: AdminUser[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

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

function buildStatusWhere(status: string | undefined) {
  if (!status || status === "all") return undefined;
  if (status === "deleted") return isNotNull(users.deletedAt);
  if (status === "suspended")
    return and(isNull(users.deletedAt), eq(users.accountStatus, "dormant"));
  return and(isNull(users.deletedAt), isNotNull(users.accountStatus));
}

export async function listUsers(params: AdminListParams): Promise<AdminListResult> {
  const { page, pageSize, search, status } = params;
  const offset = (page - 1) * pageSize;

  const searchWhere = search
    ? or(ilike(users.email, `%${search}%`), ilike(users.name, `%${search}%`))
    : undefined;

  const statusWhere = buildStatusWhere(status);
  const where = and(searchWhere, statusWhere);

  const [rows, [{ value: total }]] = await Promise.all([
    db
      .select()
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ value: count() }).from(users).where(where),
  ]);

  const userIds = rows.map((row) => row.id);
  const aggregatesByUser = await loadAggregatesForUsers(userIds);

  return {
    items: rows.map((row) =>
      toAdminUserDetail(row, aggregatesByUser.get(row.id) ?? emptyAggregates())
    ),
    pagination: {
      page,
      pageSize,
      total: Number(total),
      totalPages: Math.max(1, Math.ceil(Number(total) / pageSize)),
    },
  };
}

export async function findById(id: string): Promise<AdminUserDetail | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!row) return null;

  const aggregatesByUser = await loadAggregatesForUsers([row.id]);
  return toAdminUserDetail(row, aggregatesByUser.get(row.id) ?? emptyAggregates());
}

/**
 * Permanent hard delete — removes the `users` profile and its linked `auth_user`
 * identity in one transaction. Deleting `auth_user` cascades to `session` and
 * `account` via FK, which immediately invalidates any live refresh tokens.
 * Returns true if the user existed and was deleted.
 */
export async function hardDeleteUser(id: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ authSubjectId: users.authSubjectId })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!row) return false;

    if (row.authSubjectId) {
      await authIdentityRepo.deleteById(row.authSubjectId, tx);
    }
    await tx.delete(users).where(eq(users.id, id));
    return true;
  });
}

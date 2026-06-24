import { and, count, eq, ilike, isNull, isNotNull, or, desc } from "drizzle-orm";
import { db } from "../../db";
import { users } from "../../db/schema";
import * as authIdentityRepo from "./auth-identity.repository";
import type { AdminUser, AdminUserDetail } from "../../contracts/src/admin";

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

function resolveStatus(u: { deletedAt: Date | null; accountStatus: string }): AdminUser["status"] {
  if (u.deletedAt !== null) return "deleted";
  if (u.accountStatus === "dormant") return "suspended";
  return "active";
}

function toAdminUser(u: typeof users.$inferSelect): AdminUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    entitlement: u.tier === "premium" ? "premium" : "free",
    status: resolveStatus(u),
    createdAt: u.createdAt.toISOString(),
    lastActiveAt: u.updatedAt ? u.updatedAt.toISOString() : null,
  };
}

function toAdminUserDetail(u: typeof users.$inferSelect): AdminUserDetail {
  return {
    ...toAdminUser(u),
    goal: u.goal ?? null,
    targetCalories: u.dailyTargetKcal ?? null,
    totalFoodLogs: 0, // populated from food-log repo when joins are added
    currentStreakDays: 0,
    subscription: null,
  };
}

function buildStatusWhere(status: string | undefined) {
  if (!status || status === "all") return undefined;
  if (status === "deleted") return isNotNull(users.deletedAt);
  if (status === "suspended")
    return and(isNull(users.deletedAt), eq(users.accountStatus, "dormant"));
  // "active"
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

  return {
    items: rows.map(toAdminUser),
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
  return row ? toAdminUserDetail(row) : null;
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

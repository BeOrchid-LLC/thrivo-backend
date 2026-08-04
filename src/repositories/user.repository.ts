import { and, asc, eq, gt, gte, isNull, or, sql } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { userSettings, users, type NewUserRow, type UserRow } from "../../db/schema";

export type User = UserRow;

/**
 * Stamp liveness. Raw SQL on purpose: a query-builder update would fire
 * updated_at's $onUpdate, conflating "active" with "profile changed". Throttle
 * upstream (activity.service) — this is an unconditional write.
 */
export async function touchLastActive(id: string, tx: Executor = db): Promise<void> {
  await tx.execute(sql`update ${users} set last_active_at = now() where id = ${id}`);
}

/** Total active (not soft-deleted) user count — used by admin overview metrics. */
export async function countActive(tx: Executor = db): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(isNull(users.deletedAt));
  return row?.count ?? 0;
}

/** Active users whose `last_active_at` is on or after `since` — the DAU/MAU signal. */
export async function countActiveSince(since: Date, tx: Executor = db): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(and(isNull(users.deletedAt), gte(users.lastActiveAt, since)));
  return row?.count ?? 0;
}

/** Active = not soft-deleted. Every read excludes soft-deleted rows. */
export async function findById(id: string, tx: Executor = db): Promise<User | null> {
  const [row] = await tx
    .select()
    .from(users)
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function findActiveByEmail(email: string, tx: Executor = db): Promise<User | null> {
  const [row] = await tx
    .select()
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)))
    .limit(1);
  return row ?? null;
}

/** Look up the domain profile by its linked auth identity (identity reconcile). */
export async function findByAuthSubjectId(
  authSubjectId: string,
  tx: Executor = db
): Promise<User | null> {
  const [row] = await tx
    .select()
    .from(users)
    .where(and(eq(users.authSubjectId, authSubjectId), isNull(users.deletedAt)))
    .limit(1);
  return row ?? null;
}

/** Bind an existing profile to an auth identity (first sign-in via a new method). */
export async function linkAuthSubject(
  id: string,
  authSubjectId: string,
  tx: Executor = db
): Promise<User | null> {
  const [row] = await tx
    .update(users)
    .set({ authSubjectId })
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .returning();
  return row ?? null;
}

export async function createUser(input: NewUserRow, tx: Executor = db): Promise<User> {
  const [row] = await tx.insert(users).values(input).returning();
  return row;
}

export async function updateProfile(
  id: string,
  patch: Partial<NewUserRow>,
  tx: Executor = db
): Promise<User | null> {
  const [row] = await tx
    .update(users)
    .set(patch)
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .returning();
  return row ?? null;
}

/** GDPR-friendly soft delete (recovery/audit). Hard erasure cascades elsewhere. */
export async function softDeleteUser(id: string, tx: Executor = db): Promise<void> {
  await tx.update(users).set({ deletedAt: new Date() }).where(eq(users.id, id));
}

export interface WeeklyReviewCandidate {
  id: string;
  email: string;
  timezone: string | null;
  createdAt: Date;
}

/**
 * Keyset page of users whose local calendar is Sunday and clock is at least
 * 09:00. The 15-minute scheduler provides same-Sunday outage recovery while
 * the semantic email dedupe key prevents repeat delivery. A missing settings
 * row counts as enabled; invalid legacy timezone values are excluded.
 */
export async function listEligibleForWeeklyReviewPage(
  at: Date,
  afterUserId: string | null,
  limit: number,
  tx: Executor = db
): Promise<WeeklyReviewCandidate[]> {
  return tx
    .select({
      id: users.id,
      email: users.email,
      timezone: users.timezone,
      createdAt: users.createdAt,
    })
    .from(users)
    .leftJoin(userSettings, eq(userSettings.userId, users.id))
    .where(
      and(
        isNull(users.deletedAt),
        eq(users.emailVerified, true),
        or(isNull(userSettings.userId), eq(userSettings.weeklyReviewEmailEnabled, true)),
        sql`(${users.timezone} is null or exists (select 1 from pg_timezone_names where name = ${users.timezone}))`,
        sql`(
          case
            when ${users.timezone} is null
              or exists (select 1 from pg_timezone_names where name = ${users.timezone})
            then extract(dow from (${at} at time zone coalesce(${users.timezone}, 'UTC')))::int
            else null
          end
        ) = 0`,
        sql`(
          case
            when ${users.timezone} is null
              or exists (select 1 from pg_timezone_names where name = ${users.timezone})
            then (${at} at time zone coalesce(${users.timezone}, 'UTC'))::time
            else null
          end
        ) >= time '09:00'`,
        afterUserId ? gt(users.id, afterUserId) : undefined
      )
    )
    .orderBy(asc(users.id))
    .limit(limit);
}

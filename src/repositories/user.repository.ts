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
}

/**
 * Keyset page of users whose local clock currently reads `targetLocalHour` —
 * backs the weekly-review email's per-timezone-bucketed send (an hourly cron
 * calls this with the current UTC hour's bucket instead of one fixed daily
 * run). A missing settings row counts as enabled, same convention as
 * `pushTokenRepo.listActiveForNudgesPage`. An invalid `users.timezone` (it's
 * unvalidated free text) simply excludes that user rather than erroring the
 * whole query.
 */
export async function listEligibleForWeeklyReviewPage(
  targetLocalHour: number,
  afterUserId: string | null,
  limit: number,
  tx: Executor = db
): Promise<WeeklyReviewCandidate[]> {
  return tx
    .select({ id: users.id, email: users.email, timezone: users.timezone })
    .from(users)
    .leftJoin(userSettings, eq(userSettings.userId, users.id))
    .where(
      and(
        isNull(users.deletedAt),
        or(isNull(userSettings.userId), eq(userSettings.emailFoodLogReminderEnabled, true)),
        sql`(${users.timezone} is null or exists (select 1 from pg_timezone_names where name = ${users.timezone}))`,
        sql`extract(hour from (now() at time zone coalesce(${users.timezone}, 'UTC')))::int = ${targetLocalHour}`,
        afterUserId ? gt(users.id, afterUserId) : undefined
      )
    )
    .orderBy(asc(users.id))
    .limit(limit);
}

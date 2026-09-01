import { sql } from "drizzle-orm";
import { db, closeDb } from "../../db";
import { getRedis } from "../../src/lib/redis";
import { adminAccountRepo } from "../../src/repositories";
import type { Tx } from "../../db/tx";

export { db, closeDb };

/**
 * Truncate every application table (FK-cascading, identity reset) for a clean
 * slate between tests. The drizzle migration ledger lives in the `drizzle`
 * schema, so filtering to `public` leaves it untouched.
 *
 * Also clears Redis rate-limit buckets (`rl:*`) and admin authorization
 * snapshots (`admin:snapshot:*`) so tests that share a Redis instance cannot
 * leak throttling or stale admin row IDs between test cases.
 */
export async function resetDb(): Promise<void> {
  const result = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`
  );
  const tables = result.rows.map((r) => `"${r.tablename}"`);
  if (tables.length === 0) return;
  await db.execute(sql.raw(`truncate table ${tables.join(", ")} restart identity cascade`));

  const redis = getRedis();
  const transientKeys = await redis.keys("rl:*");
  const snapshotKeys = await redis.keys("admin:snapshot:*");
  const keysToDelete = [...transientKeys, ...snapshotKeys];
  if (keysToDelete.length > 0) await redis.del(...keysToDelete);

  // Seed the standard test admin accounts so requireAdmin's admin_users lookup
  // succeeds for any test that signs a JWT for these emails.
  await Promise.all([
    adminAccountRepo.upsertActiveNoPassword({
      email: "admin@test.thrivo.fit",
      name: null,
      role: "admin",
    }),
    adminAccountRepo.upsertActiveNoPassword({
      email: "support@test.thrivo.fit",
      name: null,
      role: "support",
    }),
    adminAccountRepo.upsertActiveNoPassword({
      email: "read-only@test.thrivo.fit",
      name: null,
      role: "read-only",
    }),
  ]);
}

/**
 * Run `fn` inside a transaction that always rolls back — isolation without a
 * truncate, for tests that shouldn't leave a trace. Returns `fn`'s result.
 */
export async function withRolledBackTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const ROLLBACK = Symbol("rollback");
  let result: T;
  try {
    await db.transaction(async (tx) => {
      result = await fn(tx);
      throw ROLLBACK; // unwind the tx without committing
    });
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
  return result!;
}

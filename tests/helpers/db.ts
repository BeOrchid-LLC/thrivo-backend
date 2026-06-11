import { sql } from "drizzle-orm";
import { db, closeDb } from "../../db";
import type { Tx } from "../../db/tx";

export { db, closeDb };

/**
 * Truncate every application table (FK-cascading, identity reset) for a clean
 * slate between tests. The drizzle migration ledger lives in the `drizzle`
 * schema, so filtering to `public` leaves it untouched.
 */
export async function resetDb(): Promise<void> {
  const result = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`
  );
  const tables = result.rows.map((r) => `"${r.tablename}"`);
  if (tables.length === 0) return;
  await db.execute(sql.raw(`truncate table ${tables.join(", ")} restart identity cascade`));
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

import { fileURLToPath } from "node:url";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { env } from "../src/env";
import { logger } from "../src/lib/logger";

/**
 * Forward-only migration runner for CI, the Coolify pre-deploy step, and the
 * test harness. Uses drizzle-orm's programmatic migrator (not drizzle-kit) so
 * the production image carries no dev tooling. Applies db/migrations/*.sql in
 * journal order — the hand-authored bootstrap (CREATE EXTENSION citext) first,
 * then the generated schema — and is idempotent: applied migrations are skipped.
 *
 * The folder is resolved from the working directory, which is the app root in
 * every context (`tsx db/migrate.ts` in CI, `node dist/migrate.js` from /app in
 * the image, vitest from the repo root), so the same `db/migrations` path holds.
 */

// Stable, arbitrary key for the migration critical section. Every booter uses
// the same value so they contend on one lock.
const MIGRATION_LOCK_KEY = 4011982;

export async function runMigrations(): Promise<void> {
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 });
  const db = drizzle(pool);
  // A dedicated connection holds the advisory lock so it never competes with the
  // migrator for the (max:1) pool connection.
  const lockClient = new pg.Client({ connectionString: env.DATABASE_URL });
  try {
    await lockClient.connect();
    // Serialize concurrent booters. Under a rolling deploy several API replicas
    // start at once and each calls runMigrations(); without this they race on the
    // non-idempotent DDL (e.g. CREATE TYPE) and all but one crash with a duplicate
    // error. The lock makes the loser wait, after which the migrator sees every
    // migration already applied and no-ops. Session-scoped: auto-released if the
    // process dies mid-migration, so a crash can't wedge the lock.
    await lockClient.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await migrate(db, { migrationsFolder: "db/migrations" });
    logger.info("migrations applied");
  } finally {
    try {
      await lockClient.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    } catch {
      // Best-effort: the session lock releases on disconnect regardless.
    }
    await lockClient.end().catch(() => {});
    await pool.end();
  }
}

// Auto-run only when executed as the entrypoint (CLI / bundled dist), not when
// imported (e.g. the test harness calls runMigrations() itself).
const isMain = (() => {
  try {
    return (
      process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
    );
  } catch {
    return false;
  }
})();

if (isMain) {
  runMigrations().catch((err) => {
    logger.error({ err }, "migration failed");
    process.exit(1);
  });
}

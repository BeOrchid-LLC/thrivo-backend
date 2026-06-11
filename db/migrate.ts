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
export async function runMigrations(): Promise<void> {
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 });
  const db = drizzle(pool);
  try {
    await migrate(db, { migrationsFolder: "db/migrations" });
    logger.info("migrations applied");
  } finally {
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

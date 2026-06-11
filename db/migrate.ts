import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { env } from "../src/env";
import { logger } from "../src/lib/logger";

/**
 * Forward-only migration runner for CI and the Coolify pre-deploy step. Uses
 * drizzle-orm's programmatic migrator (not drizzle-kit) so the production image
 * carries no dev tooling. Applies db/migrations/*.sql in journal order — the
 * hand-authored bootstrap (CREATE EXTENSION citext) first, then the generated
 * schema — and is idempotent: already-applied migrations are skipped.
 *
 * The folder is resolved from the working directory, which is the app root in
 * both contexts (`tsx db/migrate.ts` in CI, `node dist/migrate.js` from /app in
 * the image), so the same `db/migrations` path holds.
 */
async function runMigrations(): Promise<void> {
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 });
  const db = drizzle(pool);
  try {
    await migrate(db, { migrationsFolder: "db/migrations" });
    logger.info("migrations applied");
  } finally {
    await pool.end();
  }
}

runMigrations().catch((err) => {
  logger.error({ err }, "migration failed");
  process.exit(1);
});

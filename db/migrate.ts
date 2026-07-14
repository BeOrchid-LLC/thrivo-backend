import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";
import pg from "pg";
import { env } from "../src/env";
import { logger } from "../src/lib/logger";

/**
 * Forward-only migration runner for CI, the Coolify pre-deploy step, and the
 * test harness. Normal migrations use Drizzle's transactional migrator. A
 * migration containing CREATE INDEX CONCURRENTLY is applied statement-by-
 * statement outside a transaction because PostgreSQL forbids that DDL inside
 * one; the migration is recorded in the same Drizzle ledger afterward.
 */

const MIGRATION_LOCK_KEY = 4011982;
const MIGRATIONS_FOLDER = "db/migrations";
const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface MigrationJournal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

function isConcurrentIndexMigration(migration: MigrationMeta): boolean {
  return migration.sql.some((statement) => /create\s+index\s+concurrently/i.test(statement));
}

async function applyOutsideTransaction(pool: pg.Pool, migration: MigrationMeta): Promise<void> {
  for (const statement of migration.sql) {
    if (statement.trim()) await pool.query(statement);
  }
  await pool.query(
    `insert into "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" ("hash", "created_at") values ($1, $2)`,
    [migration.hash, migration.folderMillis]
  );
}

async function appliedMigrationHashes(pool: pg.Pool): Promise<Set<string>> {
  const result = await pool.query<{ hash: string }>(
    'select "hash" from "drizzle"."__drizzle_migrations"'
  );
  return new Set(result.rows.map((row) => row.hash));
}

async function runMigrations(): Promise<void> {
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 });
  const db = drizzle(pool);
  const lockClient = new pg.Client({ connectionString: env.DATABASE_URL });
  const migrationsFolder = path.resolve(MIGRATIONS_FOLDER);

  try {
    await lockClient.connect();
    await lockClient.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);

    const journal = JSON.parse(
      await fs.readFile(path.join(migrationsFolder, "meta", "_journal.json"), "utf8")
    ) as MigrationJournal;
    const migrations = readMigrationFiles({ migrationsFolder });
    const concurrentIndex = migrations.findIndex(isConcurrentIndexMigration);

    if (concurrentIndex < 0) {
      await migrate(db, { migrationsFolder });
    } else {
      const tempFolder = await fs.mkdtemp(path.join(os.tmpdir(), "thrivo-migrations-"));
      try {
        const priorEntries = journal.entries.slice(0, concurrentIndex);
        await fs.mkdir(path.join(tempFolder, "meta"), { recursive: true });
        await fs.writeFile(
          path.join(tempFolder, "meta", "_journal.json"),
          JSON.stringify({ ...journal, entries: priorEntries })
        );
        for (const entry of priorEntries) {
          await fs.copyFile(
            path.join(migrationsFolder, `${entry.tag}.sql`),
            path.join(tempFolder, `${entry.tag}.sql`)
          );
        }

        // Creates the ledger and applies any pending transactional migrations
        // before the first concurrent-index migration.
        await migrate(db, { migrationsFolder: tempFolder });

        const appliedHashes = await appliedMigrationHashes(pool);
        let index = concurrentIndex;
        while (index < migrations.length && isConcurrentIndexMigration(migrations[index]!)) {
          const migration = migrations[index]!;
          if (!appliedHashes.has(migration.hash)) {
            await applyOutsideTransaction(pool, migration);
            appliedHashes.add(migration.hash);
          }
          index += 1;
        }

        // Applies any ordinary migrations after the concurrent migration(s).
        await migrate(db, { migrationsFolder });
      } finally {
        await fs.rm(tempFolder, { recursive: true, force: true });
      }
    }

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

export { runMigrations };

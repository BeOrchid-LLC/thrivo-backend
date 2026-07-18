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
 * Migration execution is deliberately split by deployment context:
 *
 * - strict: CI/local migration commands wait for every migration, including
 *   optional concurrent indexes;
 * - deployment: Coolify's pre-deploy command applies required schema changes
 *   but leaves optional concurrent indexes for the API process;
 * - startup: the API applies required schema changes before binding, then
 *   returns the pending optional indexes for post-bind execution.
 *
 * Deferral is an explicit allowlist, never inferred from "contains
 * CONCURRENTLY", so a correctness migration is never deferred by accident.
 * - 0027 only adds/removes performance indexes.
 * - 0028 adds the OFF origin_ref uniqueness backstop. Deferring it opens a
 *   short per-deploy window before the index exists, but duplicates are
 *   already prevented app-side by findActiveByOriginRef's pre-check
 *   (upsertOffProduct); the index only guards a true concurrent-insert race.
 *   Building it CONCURRENTLY (out of the drizzle transaction, no long lock on
 *   food_items) is the only consistent option.
 *
 * Deferred migrations are NO LONGER required to be positionally terminal:
 * runMigrations partitions the allowlisted deferred migrations out and applies
 * them last (post-bind), so ordinary schema migrations can be appended after
 * them (e.g. 0029+). This holds because a deferred migration is always a
 * standalone index backstop that later migrations do not depend on.
 */

const MIGRATION_LOCK_KEY = 4011982;
const MIGRATIONS_FOLDER = "db/migrations";
const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";
const DEFERRED_MIGRATION_TAGS = new Set([
  "0027_cheerful_hannibal_king",
  "0028_striped_randall_flagg",
]);
const DEFERRED_LOCK_TIMEOUT = "10s";
const DEFERRED_STATEMENT_TIMEOUT = "15min";
const MIGRATION_LOCK_WAIT_TIMEOUT_MS = 60_000;
const MIGRATION_LOCK_RETRY_DELAY_MS = 1_000;

export type MigrationMode = "strict" | "deployment" | "startup";

export interface MigrationRunResult {
  deferredTags: string[];
}

export interface LoadedMigration extends MigrationMeta {
  tag: string;
}

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

function isDeferredMigration(migration: Pick<LoadedMigration, "tag">): boolean {
  return DEFERRED_MIGRATION_TAGS.has(migration.tag);
}

function isConcurrentIndexStatement(statement: string): boolean {
  return /^(drop|create)\s+(unique\s+)?index\s+concurrently\b/i.test(statement.trim());
}

function validateDeferredMigrations(
  migrations: readonly LoadedMigration[],
  journal: MigrationJournal
): void {
  if (!migrations.some(isDeferredMigration)) return;

  // Deferred CONCURRENTLY-index migrations no longer have to be positionally
  // terminal: runMigrations partitions them out and always applies them LAST
  // (post-bind), so a normal migration may follow a deferred one in sequence.
  // The remaining invariants still hold: a deferred migration must contain only
  // concurrent-index DDL, and must exist in the journal.
  for (const migration of migrations.filter(isDeferredMigration)) {
    const statements = migration.sql.filter((statement) => statement.trim());
    if (
      statements.length === 0 ||
      statements.some((statement) => !isConcurrentIndexStatement(statement))
    ) {
      throw new Error("Deferred migration " + migration.tag + " contains non-index SQL");
    }
  }

  const journalTags = new Set(journal.entries.map((entry) => entry.tag));
  for (const migration of migrations.filter(isDeferredMigration)) {
    if (!journalTags.has(migration.tag)) {
      throw new Error(
        "Deferred migration " + migration.tag + " is missing from the migration journal"
      );
    }
  }
}

export async function acquireMigrationLock(
  client: Pick<pg.Client, "query">,
  timeoutMs = MIGRATION_LOCK_WAIT_TIMEOUT_MS,
  retryDelayMs = MIGRATION_LOCK_RETRY_DELAY_MS
): Promise<void> {
  const startedAt = Date.now();
  let attempts = 0;

  while (true) {
    attempts += 1;
    const result = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [MIGRATION_LOCK_KEY]
    );
    if (result.rows[0]?.locked) {
      logger.info({ attempts, waitMs: Date.now() - startedAt }, "migration lock acquired");
      return;
    }

    const elapsedMs = Date.now() - startedAt;
    const remainingMs = timeoutMs - elapsedMs;
    if (remainingMs <= 0) {
      const error = new Error("timed out waiting for the migration advisory lock");
      logger.error({ attempts, waitMs: elapsedMs }, "migration lock acquisition timed out");
      throw error;
    }

    if (attempts === 1 || attempts % 5 === 0) {
      logger.warn({ attempts, waitMs: elapsedMs }, "migration lock busy; retrying");
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, Math.min(retryDelayMs, remainingMs));
    });
  }
}
async function appliedMigrationHashes(pool: pg.Pool): Promise<Set<string>> {
  const result = await pool.query<{ hash: string }>(
    'select "hash" from "drizzle"."__drizzle_migrations"'
  );
  return new Set(result.rows.map((row) => row.hash));
}

/**
 * Build a temp migrations folder containing every NON-deferred migration (in
 * journal order), excluding the allowlisted deferred CONCURRENTLY-index ones.
 * `migrate()` runs these transactionally; the deferred ones are applied
 * separately post-bind. Deferred migrations are excluded regardless of their
 * position, so a normal migration appended after a deferred one still runs in
 * this transactional phase (the deferred index it skips is not a dependency).
 */
async function createNonDeferredMigrationFolder(
  migrationsFolder: string,
  journal: MigrationJournal
): Promise<string> {
  const tempFolder = await fs.mkdtemp(path.join(os.tmpdir(), "thrivo-migrations-"));
  const nonDeferredEntries = journal.entries.filter(
    (entry) => !DEFERRED_MIGRATION_TAGS.has(entry.tag)
  );
  await fs.mkdir(path.join(tempFolder, "meta"), { recursive: true });
  await fs.writeFile(
    path.join(tempFolder, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries: nonDeferredEntries })
  );
  for (const entry of nonDeferredEntries) {
    await fs.copyFile(
      path.join(migrationsFolder, entry.tag + ".sql"),
      path.join(tempFolder, entry.tag + ".sql")
    );
  }
  return tempFolder;
}

async function configureDeferredSession(client: pg.Client): Promise<void> {
  // These settings apply only to the dedicated advisory-lock session and do
  // not change database-wide defaults or affect request connections.
  await client.query("SELECT set_config('lock_timeout', $1, false)", [DEFERRED_LOCK_TIMEOUT]);
  await client.query("SELECT set_config('statement_timeout', $1, false)", [
    DEFERRED_STATEMENT_TIMEOUT,
  ]);
}

async function recordMigration(pool: pg.Pool, migration: LoadedMigration): Promise<void> {
  const ledgerSql =
    'insert into "' +
    MIGRATIONS_SCHEMA +
    '"."' +
    MIGRATIONS_TABLE +
    '" ("hash", "created_at") values ($1, $2)';
  await pool.query(ledgerSql, [migration.hash, migration.folderMillis]);
}

export async function applyDeferredStatements(
  query: (statement: string) => Promise<unknown>,
  migration: LoadedMigration,
  record: () => Promise<void>,
  shouldStop: () => boolean = () => false
): Promise<void> {
  const statements = migration.sql.filter((statement) => statement.trim());

  for (const [index, statement] of statements.entries()) {
    if (shouldStop()) return;
    const startedAt = Date.now();
    logger.info(
      {
        migration: migration.tag,
        statement: index + 1,
        totalStatements: statements.length,
      },
      "deferred migration statement started"
    );
    try {
      await query(statement);
      logger.info(
        {
          migration: migration.tag,
          statement: index + 1,
          totalStatements: statements.length,
          durationMs: Date.now() - startedAt,
        },
        "deferred migration statement completed"
      );
    } catch (err) {
      logger.error(
        {
          err,
          migration: migration.tag,
          statement: index + 1,
          totalStatements: statements.length,
          durationMs: Date.now() - startedAt,
        },
        "deferred migration statement failed"
      );
      throw err;
    }
  }

  // The ledger is written only after every DDL statement succeeds. If the
  // process dies before this insert, the next run retries the whole migration;
  // migration 0027 starts with idempotent DROP INDEX IF EXISTS statements.
  await record();
  logger.info({ migration: migration.tag }, "deferred migration recorded");
}

async function applyDeferredMigration(
  client: pg.Client,
  pool: pg.Pool,
  migration: LoadedMigration,
  shouldStop: () => boolean
): Promise<void> {
  await applyDeferredStatements(
    (statement) => client.query(statement),
    migration,
    () => recordMigration(pool, migration),
    shouldStop
  );
}

async function readMigrationState(): Promise<{
  migrationsFolder: string;
  migrations: LoadedMigration[];
  journal: MigrationJournal;
}> {
  const migrationsFolder = path.resolve(MIGRATIONS_FOLDER);
  const journal = JSON.parse(
    await fs.readFile(path.join(migrationsFolder, "meta", "_journal.json"), "utf8")
  ) as MigrationJournal;
  const migrations = readMigrationFiles({ migrationsFolder }).map((migration, index) => {
    const tag = journal.entries[index]?.tag;
    if (!tag) throw new Error("Migration metadata is missing a journal tag at index " + index);
    return { ...migration, tag };
  });
  validateDeferredMigrations(migrations, journal);
  return { migrationsFolder, migrations, journal };
}

async function applyPendingDeferredMigrations(
  client: pg.Client,
  pool: pg.Pool,
  migrations: readonly LoadedMigration[],
  shouldStop: () => boolean
): Promise<void> {
  const appliedHashes = await appliedMigrationHashes(pool);
  await configureDeferredSession(client);

  for (const migration of migrations.filter(isDeferredMigration)) {
    if (shouldStop()) return;
    if (appliedHashes.has(migration.hash)) continue;
    await applyDeferredMigration(client, pool, migration, shouldStop);
    appliedHashes.add(migration.hash);
  }
}

/**
 * Apply all pending migrations. In startup/deployment modes, optional terminal
 * index migrations are left pending and returned to the caller.
 */
export async function runMigrations(mode: MigrationMode = "strict"): Promise<MigrationRunResult> {
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 });
  const db = drizzle(pool);
  const lockClient = new pg.Client({ connectionString: env.DATABASE_URL });
  let migrationLockAcquired = false;

  try {
    await lockClient.connect();
    await acquireMigrationLock(lockClient);
    migrationLockAcquired = true;
    const { migrationsFolder, migrations, journal } = await readMigrationState();

    if (!migrations.some(isDeferredMigration)) {
      await migrate(db, { migrationsFolder });
      logger.info({ mode }, "migrations applied");
      return { deferredTags: [] };
    }

    const tempFolder = await createNonDeferredMigrationFolder(migrationsFolder, journal);
    try {
      // The temporary journal contains every non-deferred migration, so this
      // path never blocks on CONCURRENTLY. Deferred index migrations are
      // partitioned out and applied post-bind, regardless of their position.
      await migrate(db, { migrationsFolder: tempFolder });
    } finally {
      await fs.rm(tempFolder, { recursive: true, force: true });
    }

    if (mode === "strict") {
      await applyPendingDeferredMigrations(lockClient, pool, migrations, () => false);
      logger.info({ mode }, "migrations applied");
      return { deferredTags: [] };
    }

    const appliedHashes = await appliedMigrationHashes(pool);
    const deferredTags = migrations
      .filter(isDeferredMigration)
      .filter((migration) => !appliedHashes.has(migration.hash))
      .map((migration) => migration.tag);
    logger.info({ mode, deferredTags }, "required migrations applied; deferred indexes pending");
    return { deferredTags };
  } finally {
    if (migrationLockAcquired) {
      try {
        await lockClient.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
      } catch {
        // Best-effort: the session lock releases on disconnect regardless.
      }
    }
    await lockClient.end().catch(() => {});
    await pool.end();
  }
}

/** Run pending optional indexes after the API has bound its listening port. */
export async function runDeferredMigrations(
  shouldStop: () => boolean = () => false
): Promise<void> {
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 });
  const lockClient = new pg.Client({ connectionString: env.DATABASE_URL });
  let migrationLockAcquired = false;

  try {
    await lockClient.connect();
    // Configure timeouts before waiting for the advisory lock so a stale
    // migration process cannot leave the background task waiting forever.
    await configureDeferredSession(lockClient);
    await acquireMigrationLock(lockClient);
    migrationLockAcquired = true;
    const { migrations } = await readMigrationState();
    await applyPendingDeferredMigrations(lockClient, pool, migrations, shouldStop);
    logger.info("deferred migrations complete");
  } finally {
    if (migrationLockAcquired) {
      try {
        await lockClient.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
      } catch {
        // Best-effort: the session lock releases on disconnect regardless.
      }
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
  const mode: MigrationMode = process.argv.includes("--deployment") ? "deployment" : "strict";
  runMigrations(mode).catch((err) => {
    logger.error({ err, mode }, "migration failed");
    process.exit(1);
  });
}

export {
  DEFERRED_MIGRATION_TAGS,
  isConcurrentIndexStatement,
  isDeferredMigration,
  validateDeferredMigrations,
};

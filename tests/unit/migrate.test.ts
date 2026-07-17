import { describe, expect, it, vi } from "vitest";
import type { MigrationMeta } from "drizzle-orm/migrator";
import type { Client } from "pg";
import {
  acquireMigrationLock,
  applyDeferredStatements,
  isConcurrentIndexStatement,
  isDeferredMigration,
  validateDeferredMigrations,
} from "../../db/migrate";

function migration(tag: string, sql: string[]): MigrationMeta & { tag: string } {
  return { tag, sql } as MigrationMeta & { tag: string };
}

function journal(...tags: string[]) {
  return {
    version: "7",
    dialect: "postgresql",
    entries: tags.map((tag, idx) => ({
      idx,
      version: "7",
      when: idx,
      tag,
      breakpoints: true,
    })),
  };
}

describe("migration deferral policy", () => {
  it("polls for the advisory lock without blocking PostgreSQL", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ locked: false }] })
      .mockResolvedValueOnce({ rows: [{ locked: true }] });

    await acquireMigrationLock({ query } as unknown as Pick<Client, "query">, 100, 0);

    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenLastCalledWith("SELECT pg_try_advisory_lock($1) AS locked", [4011982]);
  });

  it("times out instead of waiting indefinitely for the advisory lock", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ locked: false }] });

    await expect(
      acquireMigrationLock({ query } as unknown as Pick<Client, "query">, 0, 0)
    ).rejects.toThrow("timed out waiting for the migration advisory lock");
  });
  it("recognizes only concurrent index statements", () => {
    expect(isConcurrentIndexStatement('DROP INDEX CONCURRENTLY IF EXISTS "old_idx"')).toBe(true);
    expect(
      isConcurrentIndexStatement('CREATE INDEX CONCURRENTLY "new_idx" ON "users" ("id")')
    ).toBe(true);
    expect(
      isConcurrentIndexStatement('CREATE UNIQUE INDEX CONCURRENTLY "uniq_idx" ON "users" ("id")')
    ).toBe(true);
    expect(isConcurrentIndexStatement('ALTER TABLE "users" ADD COLUMN "name" text')).toBe(false);
  });

  it("does not record a timed-out migration in the ledger", async () => {
    const timeout = Object.assign(new Error("canceling statement due to statement timeout"), {
      code: "57014",
    });
    const query = vi.fn().mockRejectedValue(timeout);
    const record = vi.fn(async () => undefined);
    const deferred = migration("0027_cheerful_hannibal_king", [
      'CREATE INDEX CONCURRENTLY "new_idx" ON "users" ("id")',
    ]);

    await expect(applyDeferredStatements(query, deferred, record)).rejects.toMatchObject({
      code: "57014",
    });
    expect(record).not.toHaveBeenCalled();
  });

  it("can retry a partial failure and records only after all statements succeed", async () => {
    let firstAttempt = true;
    const query = vi.fn(async () => {
      if (firstAttempt) {
        firstAttempt = false;
        throw Object.assign(new Error("lock timeout"), { code: "55P03" });
      }
    });
    const record = vi.fn(async () => undefined);
    const deferred = migration("0027_cheerful_hannibal_king", [
      'DROP INDEX CONCURRENTLY IF EXISTS "old_idx"',
      'CREATE INDEX CONCURRENTLY "new_idx" ON "users" ("id")',
    ]);

    await expect(applyDeferredStatements(query, deferred, record)).rejects.toMatchObject({
      code: "55P03",
    });
    await applyDeferredStatements(query, deferred, record);

    expect(query).toHaveBeenCalledTimes(3);
    expect(record).toHaveBeenCalledOnce();
  });

  it("defers only the explicitly approved migration tags", () => {
    expect(
      isDeferredMigration(migration("0027_cheerful_hannibal_king", ["CREATE INDEX CONCURRENTLY x"]))
    ).toBe(true);
    expect(
      isDeferredMigration(
        migration("0028_striped_randall_flagg", ["CREATE UNIQUE INDEX CONCURRENTLY x"])
      )
    ).toBe(true);
    expect(
      isDeferredMigration(migration("0029_future_migration", ["CREATE INDEX CONCURRENTLY x"]))
    ).toBe(false);
  });

  it("accepts a terminal index-only deferred migration", () => {
    const migrations = [
      migration("0026_before", ['ALTER TABLE "users" ADD COLUMN "x" text']),
      migration("0027_cheerful_hannibal_king", [
        'DROP INDEX CONCURRENTLY IF EXISTS "old_idx"',
        'CREATE INDEX CONCURRENTLY "new_idx" ON "users" ("id")',
      ]),
    ];

    expect(() =>
      validateDeferredMigrations(migrations, journal("0026_before", "0027_cheerful_hannibal_king"))
    ).not.toThrow();
  });

  it("rejects a deferred migration followed by another migration", () => {
    const migrations = [
      migration("0027_cheerful_hannibal_king", [
        'CREATE INDEX CONCURRENTLY "new_idx" ON "users" ("id")',
      ]),
      migration("0028_future_migration", ['ALTER TABLE "users" ADD COLUMN "x" text']),
    ];

    expect(() =>
      validateDeferredMigrations(
        migrations,
        journal("0027_cheerful_hannibal_king", "0028_future_migration")
      )
    ).toThrow(/terminal migrations/);
  });

  it("rejects non-index SQL inside the deferred migration", () => {
    const migrations = [
      migration("0027_cheerful_hannibal_king", [
        'CREATE INDEX CONCURRENTLY "new_idx" ON "users" ("id")',
        'ALTER TABLE "users" ADD COLUMN "x" text',
      ]),
    ];

    expect(() =>
      validateDeferredMigrations(migrations, journal("0027_cheerful_hannibal_king"))
    ).toThrow(/non-index SQL/);
  });
});

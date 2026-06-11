/**
 * Vitest globalSetup. When the DB integration suite is enabled (RUN_DB_TESTS=1),
 * apply migrations once against the test database before any suite runs. A no-op
 * otherwise, so unit-only runs never touch a database (or load env that needs one).
 */
export default async function setup(): Promise<void> {
  if (process.env.RUN_DB_TESTS !== "1") return;
  const { runMigrations } = await import("../../db/migrate");
  await runMigrations();
}

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../src/env";
import * as schema from "./schema";

/** Single pg connection pool per process (System Design §1.1 — state lives in Postgres). */
export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: env.NODE_ENV === "test" ? 5 : 10,
});

/** The Drizzle handle. Imported only by repository files (no SQL elsewhere). */
export const db = drizzle(pool, { schema });

/** Liveness probe for /ready — cheap round trip to confirm the pool can reach Postgres. */
export async function pingDb(): Promise<boolean> {
  const result = await pool.query<{ ok: number }>("select 1 as ok");
  return result.rows[0]?.ok === 1;
}

/** Drain the pool on graceful shutdown so in-flight queries finish before exit. */
export async function closeDb(): Promise<void> {
  await pool.end();
}

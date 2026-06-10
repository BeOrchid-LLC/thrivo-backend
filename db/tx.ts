import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type * as schema from "./schema";
import type { db } from "./index";

/** The pool-bound Drizzle handle. */
export type Db = typeof db;

/** An active transaction handle, threaded by services into repository calls. */
export type Tx = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

/**
 * What every repository accepts as its optional last param. Defaults to `db`;
 * a service passes the active `Tx` to compose multiple repo calls atomically.
 */
export type Executor = Db | Tx;

import { customType, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "../../src/lib/ids";

/** Case-insensitive text. Requires `CREATE EXTENSION citext` (bootstrap migration). */
export const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});

/** Postgres full-text search vector. Paired with a GIN index (bootstrap migration). */
export const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

/** Standard UUIDv7 primary key, generated app-side (no DB default). */
export const idPk = () => uuid("id").primaryKey().$defaultFn(newId);

/**
 * created_at / updated_at convention. `updated_at` is maintained by the repo
 * layer via `$onUpdate` (fires on every query-builder update; safe because SQL
 * only lives in repositories) — no Postgres trigger needed.
 */
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

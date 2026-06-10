import { db } from "../../db";
import type { Executor } from "../../db/tx";

export type { Executor };

/** Resolve the executor a repo call should use: the passed transaction, or the pool-bound db. */
export const resolve = (tx?: Executor): Executor => tx ?? db;

/** Postgres unique-violation SQLSTATE — let services translate to a domain ConflictError. */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

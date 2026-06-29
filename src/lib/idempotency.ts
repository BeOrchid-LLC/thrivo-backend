import type { Context } from "hono";

/** A client UUID is 36 chars; cap well above that to bound the index key. */
const MAX_KEY_LENGTH = 200;

/**
 * Read a client-supplied `Idempotency-Key`. Clients mint this UUID when a write
 * is enqueued (offline queue / retry), so an at-least-once delivery dedupes
 * server-side against the unique (user_id, idempotency_key) index. Returns null
 * when absent; overlong values are truncated rather than rejected so a flaky
 * client never loses a write to a 4xx.
 */
export function readIdempotencyKey(c: Context): string | null {
  const raw = c.req.header("Idempotency-Key")?.trim();
  if (!raw) return null;
  return raw.slice(0, MAX_KEY_LENGTH);
}

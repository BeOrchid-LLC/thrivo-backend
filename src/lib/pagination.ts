import { ValidationError } from "./errors";

/**
 * Keyset (cursor) pagination helpers. The cursor is an opaque base64url blob
 * encoding the last-seen sort key(s); clients pass it back verbatim. Opaque on
 * purpose — the shape can evolve without breaking callers. Keyset (not offset)
 * keeps high-traffic list queries index-friendly and stable under inserts.
 */
export function encodeCursor(key: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(key), "utf8").toString("base64url");
}

export function decodeCursor<T = Record<string, unknown>>(cursor: string): T {
  try {
    return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as T;
  } catch {
    throw new ValidationError("Invalid pagination cursor", { cursor });
  }
}

/** Clamp a client-supplied page size into a safe range. */
export function clampLimit(limit: number | undefined, fallback = 20, max = 100): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(Math.trunc(limit), 1), max);
}

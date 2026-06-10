import { getRedis } from "../redis";
import { logger } from "../logger";

// Versioned key prefix — bump to invalidate everything on a breaking schema change.
const PREFIX = "v1:";

/** Cache read. On any Redis error this returns null (treated as a miss) — never throws. */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await getRedis().get(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (err) {
    logger.warn({ err, key }, "cacheGet failed; treating as miss");
    return null;
  }
}

/** Cache write with TTL. Best-effort — a Redis blip logs and moves on. */
export async function cacheSet<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  try {
    await getRedis().set(PREFIX + key, JSON.stringify(value), "EX", ttlSeconds);
  } catch (err) {
    logger.warn({ err, key }, "cacheSet failed; skipping");
  }
}

export async function cacheDel(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    await getRedis().del(...keys.map((k) => PREFIX + k));
  } catch (err) {
    logger.warn({ err, keys }, "cacheDel failed; skipping");
  }
}

/**
 * Cache-aside: return the cached value, or run `loader`, cache it, and return it.
 * If Redis is unreachable the loader still runs — a cache outage degrades to a DB
 * hit, it never fails the request.
 */
export async function cacheAside<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>
): Promise<T> {
  const cached = await cacheGet<T>(key);
  if (cached !== null) return cached;
  const value = await loader();
  await cacheSet(key, value, ttlSeconds);
  return value;
}

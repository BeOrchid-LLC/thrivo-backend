import { createHash } from "node:crypto";
import { env } from "../env";
import { RateLimitedError, UpstreamError } from "../lib/errors";
import { logger } from "../lib/logger";
import { getRedis } from "../lib/redis";
import {
  searchOpenFoodFactsProducts,
  type OpenFoodFactsSearchResult,
} from "../integrations/open-food-facts";

const SEARCH_INDEX_KEY = "v1:food-search:index";

export interface SearchResultEnvelope {
  items: OpenFoodFactsSearchResult[];
  cached: boolean;
}

export function normalizeFoodSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

function searchCacheKey(query: string, limit: number): string {
  const digest = createHash("sha256").update(`${query}|${limit}`).digest("hex");
  return `v1:food-search:${digest}`;
}

async function enforceFixedWindowLimit(
  key: string,
  max: number,
  windowSec: number,
  message: string
): Promise<void> {
  const redis = getRedis();
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, windowSec);
  if (n > max) throw new RateLimitedError(message);
}

async function readSearchCache(key: string): Promise<OpenFoodFactsSearchResult[] | null> {
  try {
    const raw = await getRedis().get(key);
    return raw ? (JSON.parse(raw) as OpenFoodFactsSearchResult[]) : null;
  } catch (err) {
    logger.warn({ err, key }, "food search cache read failed");
    return null;
  }
}

async function writeSearchCache(
  key: string,
  value: OpenFoodFactsSearchResult[],
  query: string
): Promise<void> {
  try {
    const redis = getRedis();
    await redis.set(key, JSON.stringify(value), "EX", env.FOOD_SEARCH_CACHE_TTL_SECONDS);
    await redis.zadd(SEARCH_INDEX_KEY, Date.now(), key);
    const count = await redis.zcard(SEARCH_INDEX_KEY);
    if (count > env.FOOD_SEARCH_CACHE_MAX_KEYS) {
      const overflow = await redis.zrange(
        SEARCH_INDEX_KEY,
        0,
        count - env.FOOD_SEARCH_CACHE_MAX_KEYS - 1
      );
      if (overflow.length > 0) {
        await redis.zrem(SEARCH_INDEX_KEY, ...overflow);
        await redis.del(...overflow);
      }
    }
  } catch (err) {
    logger.warn({ err, query }, "food search cache write failed");
  }
}

export async function searchExternalFoods(
  userId: string,
  query: string,
  limit: number
): Promise<SearchResultEnvelope> {
  const normalized = normalizeFoodSearchQuery(query);
  const key = searchCacheKey(normalized, limit);
  const cached = await readSearchCache(key);
  if (cached) {
    return { items: cached, cached: true };
  }

  try {
    await enforceFixedWindowLimit(
      `food-search-rl:${userId}`,
      env.FOOD_SEARCH_RATE_LIMIT_MAX,
      env.FOOD_SEARCH_RATE_LIMIT_WINDOW_SECONDS,
      "Food search limit reached - try again later"
    );
    const items = await searchOpenFoodFactsProducts(normalized, limit);
    await writeSearchCache(key, items, normalized);
    return { items, cached: false };
  } catch (err) {
    if (err instanceof RateLimitedError) throw err;
    logger.warn({ err, query: normalized }, "open food facts search failed");
    throw new UpstreamError("Could not search foods right now");
  }
}

export async function enforceBarcodeLookupLimit(userId: string): Promise<void> {
  await enforceFixedWindowLimit(
    `barcode-lookup-rl:${userId}`,
    env.BARCODE_LOOKUP_RATE_LIMIT_MAX,
    env.BARCODE_LOOKUP_RATE_LIMIT_WINDOW_SECONDS,
    "Barcode lookup limit reached - try again later"
  );
}

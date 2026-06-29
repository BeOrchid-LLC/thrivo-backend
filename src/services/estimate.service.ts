import { createHash } from "node:crypto";
import { cacheAside } from "../lib/cache";
import { getRedis } from "../lib/redis";
import { RateLimitedError } from "../lib/errors";
import { estimateNutritionViaModel } from "../integrations/anthropic/estimate";
import type { EstimateFoodPayload, Nutrients } from "../../contracts/src/foods";

const RATE_LIMIT = { max: 30, windowSec: 60 * 60 }; // per user/hour — caps spend + abuse
const CACHE_TTL_SECONDS = 60 * 60 * 24; // identical descriptions reuse one model call

function cacheKey(payload: EstimateFoodPayload): string {
  const normalized = JSON.stringify({
    name: payload.name.trim().toLowerCase(),
    ingredients: payload.ingredients?.trim().toLowerCase() ?? "",
    cookingMethod: payload.cookingMethod?.trim().toLowerCase() ?? "",
    portionMeasure: payload.portionMeasure,
    quantity: payload.quantity,
  });
  return `estimate:${createHash("sha256").update(normalized).digest("hex")}`;
}

async function enforceRateLimit(userId: string): Promise<void> {
  const redis = getRedis();
  const key = `estimate-rl:${userId}`;
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, RATE_LIMIT.windowSec);
  if (n > RATE_LIMIT.max) {
    throw new RateLimitedError("Estimate limit reached — try again later");
  }
}

/**
 * Estimate nutrition for a described meal. Cached by normalized description so a
 * repeat is free; the per-user rate limit runs inside the cache-miss path, so it
 * only counts real model calls — capping Anthropic spend and abuse. If Redis is
 * down both the cache read and the limiter fail, so no uncapped model call slips
 * through (fail closed on cost).
 */
export async function estimateNutrition(
  userId: string,
  payload: EstimateFoodPayload
): Promise<Nutrients> {
  return cacheAside(cacheKey(payload), CACHE_TTL_SECONDS, async () => {
    await enforceRateLimit(userId);
    return estimateNutritionViaModel(payload);
  });
}

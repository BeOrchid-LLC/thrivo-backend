import { createHash } from "node:crypto";
import { cacheAside } from "../lib/cache";
import { getRedis } from "../lib/redis";
import { RateLimitedError } from "../lib/errors";
import { estimateNutritionViaModel } from "../integrations/anthropic/estimate";
import type { EstimateFoodPayload, Nutrients } from "../../contracts/src/foods";
import { env } from "../env";

function cacheKey(payload: EstimateFoodPayload): string {
  const normalized = JSON.stringify({
    name: canonicalText(payload.name),
    ingredients: canonicalText(payload.ingredients ?? ""),
    cookingMethod: canonicalText(payload.cookingMethod ?? ""),
    portionMeasure: payload.portionMeasure,
    quantity: Number(payload.quantity.toFixed(3)),
  });
  return `estimate:${createHash("sha256").update(normalized).digest("hex")}`;
}

function canonicalText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

async function enforceRateLimit(userId: string): Promise<void> {
  const redis = getRedis();
  const key = `estimate-rl:${userId}`;
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, env.AI_ESTIMATE_RATE_LIMIT_WINDOW_SECONDS);
  if (n > env.AI_ESTIMATE_RATE_LIMIT_MAX) {
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
  return cacheAside(cacheKey(payload), env.AI_ESTIMATE_CACHE_TTL_SECONDS, async () => {
    await enforceRateLimit(userId);
    return estimateNutritionViaModel(payload);
  });
}

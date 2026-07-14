import { createHash } from "node:crypto";
import { cacheAside } from "../lib/cache";
import { getRedis } from "../lib/redis";
import { RateLimitedError } from "../lib/errors";
import { estimateNutritionViaModel } from "../integrations/anthropic/estimate";
import type { EstimateFoodPayload, Nutrients } from "../../contracts/src/foods";
import { env } from "../env";
import { isPremium } from "./entitlement.service";
import type { User } from "../repositories/user.repository";

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

async function enforceRateLimit(user: User): Promise<void> {
  const redis = getRedis();
  const key = `estimate-rl:${user.id}`;
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, env.AI_ESTIMATE_RATE_LIMIT_WINDOW_SECONDS);
  // Metered Anthropic spend, not a flat-cost feature — free gets a materially
  // tighter cap than premium, not the same allowance (unlike weight/water
  // tracking, which is deliberately free; see DECISION_LOG.md ADR-0014).
  const max = isPremium(user)
    ? env.AI_ESTIMATE_RATE_LIMIT_MAX
    : env.AI_ESTIMATE_RATE_LIMIT_MAX_FREE;
  if (n > max) {
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
  user: User,
  payload: EstimateFoodPayload
): Promise<Nutrients> {
  return cacheAside(cacheKey(payload), env.AI_ESTIMATE_CACHE_TTL_SECONDS, async () => {
    await enforceRateLimit(user);
    return estimateNutritionViaModel(payload);
  });
}

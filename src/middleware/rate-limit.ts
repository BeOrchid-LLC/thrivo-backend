import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import { getRedis } from "../lib/redis";
import { logger } from "../lib/logger";
import type { AppEnv } from "../types/http";

export type RateLimitOptions = {
  /** Window length in seconds. */
  windowSec: number;
  /** Max requests per client per window. */
  max: number;
  /** Namespace so buckets (global vs auth vs write) don't collide. */
  keyPrefix: string;
};

// We sit behind Cloudflare → Traefik, so the real client IP is in cf-connecting-ip
// (or the first x-forwarded-for hop). Falls back to a constant when absent.
function clientIp(c: Context): string {
  return (
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

/**
 * Redis fixed-window rate limiter. Counts requests per client per window with
 * INCR+EXPIRE; over the cap → `429` + `Retry-After` in the standard `{ error }`
 * shape. **Fails open**: if Redis is unreachable the request is served (logged),
 * because a limiter outage must never take the API down.
 */
export function rateLimit(opts: RateLimitOptions) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const key = `rl:${opts.keyPrefix}:${clientIp(c)}`;
    try {
      const redis = getRedis();
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, opts.windowSec);
      if (count > opts.max) {
        const ttl = await redis.ttl(key);
        const retryAfter = ttl > 0 ? ttl : opts.windowSec;
        c.header("Retry-After", String(retryAfter));
        return c.json({ error: { code: "RATE_LIMITED", message: "Too many requests" } }, 429);
      }
    } catch (err) {
      logger.warn({ err, keyPrefix: opts.keyPrefix }, "rate limiter unavailable; failing open");
    }
    await next();
  });
}

/** General per-IP ceiling for all `/api/v1` traffic. */
export const apiRateLimit = rateLimit({ windowSec: 60, max: 120, keyPrefix: "api" });

/** Tighter bucket for auth endpoints (credential stuffing / OTP abuse). */
export const authRateLimit = rateLimit({ windowSec: 60, max: 10, keyPrefix: "auth" });

/** Public unauthenticated write endpoint (email capture) — the classic spam-bot target. */
export const leadsRateLimit = rateLimit({ windowSec: 600, max: 5, keyPrefix: "leads-capture" });

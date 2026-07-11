import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import { getRedis } from "../lib/redis";
import { logger } from "../lib/logger";
import { RateLimitedError } from "../lib/errors";
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
    // Decide inside the try (Redis-only errors fail open here); throw the
    // AppError outside it, or the fail-open catch below would swallow a
    // legitimate 429 and serve the request anyway.
    let retryAfter: number | null = null;
    try {
      const redis = getRedis();
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, opts.windowSec);
      if (count > opts.max) {
        const ttl = await redis.ttl(key);
        retryAfter = ttl > 0 ? ttl : opts.windowSec;
      }
    } catch (err) {
      logger.warn({ err, keyPrefix: opts.keyPrefix }, "rate limiter unavailable; failing open");
    }
    if (retryAfter !== null) {
      // Set on `c` before throwing — the central errorHandler builds the JSON
      // body from this same context, so the header rides along on the 429.
      c.header("Retry-After", String(retryAfter));
      throw new RateLimitedError("Too many requests");
    }
    await next();
  });
}

/** General per-IP ceiling for all `/api/v1` traffic. */
export const apiRateLimit = rateLimit({ windowSec: 60, max: 120, keyPrefix: "api" });

/** Tighter bucket for auth endpoints (credential stuffing / OTP abuse). */
export const authRateLimit = rateLimit({ windowSec: 60, max: 10, keyPrefix: "auth" });

/**
 * Same shape as `authRateLimit`, distinct bucket for `/admin/auth/*`. Publicly
 * reachable and previously unthrottled — an IP-only cap is evadable, so this is
 * a first layer; the per-email issue throttle in `admin/otp.service.ts` is the
 * load-bearing guard against inbox-bombing + shared Resend quota exhaustion.
 */
export const adminAuthRateLimit = rateLimit({ windowSec: 60, max: 10, keyPrefix: "admin-auth" });

/** Public unauthenticated write endpoint (email capture) — the classic spam-bot target. */
export const leadsRateLimit = rateLimit({ windowSec: 600, max: 5, keyPrefix: "leads-capture" });

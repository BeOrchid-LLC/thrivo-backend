import type { Context } from "hono";
import type { SessionContext } from "./session.service";
import type { AppEnv } from "../types/http";

/**
 * Derive the session audit context (client IP + user agent) from a request.
 * IP comes from the edge header (Cloudflare → Traefik), matching the rate
 * limiter's resolution. Stored on the refresh session for device visibility.
 */
export function sessionContext(c: Context<AppEnv>): SessionContext {
  return {
    ipAddress:
      c.req.header("cf-connecting-ip") ??
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      null,
    userAgent: c.req.header("user-agent") ?? null,
  };
}

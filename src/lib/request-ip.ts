import type { Context } from "hono";
import type { AppEnv } from "../types/http";

/** Client IP from the edge header (Cloudflare → Traefik); null when absent (tests, direct calls). */
export function getClientIp(c: Context<AppEnv>): string | null {
  return (
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    null
  );
}

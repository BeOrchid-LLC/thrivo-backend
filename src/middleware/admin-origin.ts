import { createMiddleware } from "hono/factory";
import { env } from "../env";
import { ForbiddenError } from "../lib/errors";
import type { AppEnv } from "../types/http";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const allowedOrigins = new Set(env.CORS_ORIGINS);

/**
 * CSRF defense-in-depth for admin state-changing requests. The admin cookie is
 * SameSite=Strict (the primary guard), but we also reject any unsafe-method
 * request whose Origin is present and not on the CORS allowlist — so a forged
 * cross-site POST is blocked even if SameSite were ever relaxed. A request with
 * no Origin (CLI / server-to-server) carries no ambient browser cookie to
 * abuse, so it passes through.
 */
export const adminOriginGuard = createMiddleware<AppEnv>(async (c, next) => {
  if (UNSAFE_METHODS.has(c.req.method)) {
    const origin = c.req.header("Origin");
    if (origin && !allowedOrigins.has(origin)) {
      throw new ForbiddenError("Cross-origin admin request rejected");
    }
  }
  await next();
});

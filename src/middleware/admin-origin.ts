import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { env } from "../env";
import { ForbiddenError } from "../lib/errors";
import { ADMIN_COOKIE } from "../admin/session.service";
import type { AppEnv } from "../types/http";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const allowedOrigins = new Set(env.CORS_ORIGINS);

/**
 * CSRF defense for admin state-changing requests. This is the *only* CSRF
 * guard — the admin cookie is `SameSite=None; Partitioned` (cross-site, by
 * necessity: the admin SPA on admin.thrivo.fit calls api.thrivo.fit), not
 * `SameSite=Strict`, so the browser does not withhold it on a cross-site
 * request the way a Strict cookie would (ADR-0024). Two rules:
 *   1. An unsafe-method request with an Origin present must be on the CORS
 *      allowlist — blocks a forged cross-site POST even if it doesn't carry
 *      the cookie ambiently (some browsers still send it).
 *   2. An unsafe-method request that carries the admin session cookie but has
 *      **no** Origin header is rejected outright — a real browser always
 *      sends Origin on a cookie-bearing cross-site fetch/form-post, so
 *      Origin-less + cookie-authed is itself the forgery signal.
 * A request with neither the cookie nor an Origin (CLI / server-to-server) is
 * not cookie-authed and passes through — those callers must use a service
 * token, not this cookie, if they need to mutate.
 */
export const adminOriginGuard = createMiddleware<AppEnv>(async (c, next) => {
  if (UNSAFE_METHODS.has(c.req.method)) {
    const origin = c.req.header("Origin");
    if (origin) {
      if (!allowedOrigins.has(origin)) {
        throw new ForbiddenError("Cross-origin admin request rejected");
      }
    } else if (getCookie(c, ADMIN_COOKIE)) {
      throw new ForbiddenError("Cross-origin admin request rejected");
    }
  }
  await next();
});

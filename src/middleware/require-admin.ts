import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { UnauthorizedError, ForbiddenError } from "../lib/errors";
import { verifyAdminSession, ADMIN_COOKIE } from "../admin/session.service";
import type { AppEnv } from "../types/http";

/**
 * Gate admin routes: reads the httpOnly `admin_session` JWT cookie, verifies it,
 * and enforces the `admin` role. Sets `c.var.adminUser` for downstream handlers.
 * No BetterAuth dependency — the admin OTP flow issues this cookie directly.
 */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, ADMIN_COOKIE);
  if (!token) throw new UnauthorizedError("Authentication required");

  const claims = await verifyAdminSession(token);
  if (!claims) throw new UnauthorizedError("Session expired, please sign in again");
  if (claims.role !== "admin") throw new ForbiddenError("Admin access required");

  c.set("adminUser", claims);
  await next();
});

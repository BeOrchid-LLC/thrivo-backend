import { createMiddleware } from "hono/factory";
import { UnauthorizedError, ForbiddenError } from "../lib/errors";
import type { AppEnv } from "../types/http";

/**
 * Gate admin routes at the boundary. The admin role source (BetterAuth admin
 * plugin + role column) lands in A5, so this is **default-deny** today; admin
 * surfaces are additionally network-gated by Cloudflare Access (ADR-0018).
 */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.var.user) throw new UnauthorizedError("Authentication required");
  // A5: read a real role/claim. Until then no one passes — fail closed.
  const role = (c.var.user as { role?: string }).role;
  if (role !== "admin") throw new ForbiddenError("Admin access required");
  await next();
});

import { createMiddleware } from "hono/factory";
import { UnauthorizedError } from "../lib/errors";
import type { AppEnv } from "../types/http";

/**
 * Gate a protected router: 401 unless the auth middleware resolved a user.
 * Handlers downstream can treat `c.var.user` as present.
 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.var.user) throw new UnauthorizedError("Authentication required");
  await next();
});

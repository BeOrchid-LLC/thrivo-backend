import { createMiddleware } from "hono/factory";
import { verifyRequest } from "../auth";
import { resolveUser } from "../services/identity.service";
import type { AppEnv } from "../types/http";

/**
 * Resolve the request's session (cookie or bearer) into our domain user and put
 * it on `c.var.user`. Non-fatal: anonymous requests pass through with no user —
 * `require-auth` is what enforces presence on protected routers.
 */
export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const principal = await verifyRequest(c.req.raw.headers);
  if (principal) {
    c.set("user", await resolveUser(principal));
  }
  await next();
});

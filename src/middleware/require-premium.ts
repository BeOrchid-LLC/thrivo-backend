import { createMiddleware } from "hono/factory";
import { UnauthorizedError } from "../lib/errors";
import { assertPremium } from "../services/entitlement.service";
import type { AppEnv } from "../types/http";

/** Gate premium-only routes centrally (macros, metrics, check-ins, full history). */
export const requirePremium = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.var.user) throw new UnauthorizedError("Authentication required");
  assertPremium(c.var.user);
  await next();
});

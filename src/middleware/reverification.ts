import { createMiddleware } from "hono/factory";
import { ReverificationRequiredError } from "../lib/errors";
import type { AppEnv } from "../types/http";

/** Sensitive account operations require a fresh first factor (ten minutes). */
export const requireRecentVerification = createMiddleware<AppEnv>(async (c, next) => {
  const principal = c.get("principal");
  const user = c.get("user");
  if (!user) {
    await next();
    return;
  }
  const fva = principal?.factorVerificationAge;
  const maxAgeSeconds = 10 * 60;
  if (!fva || fva[0] < 0 || fva[0] > maxAgeSeconds || (fva[1] >= 0 && fva[1] > maxAgeSeconds)) {
    throw new ReverificationRequiredError();
  }
  await next();
});

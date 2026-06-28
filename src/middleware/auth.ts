import { createMiddleware } from "hono/factory";
import { verifyRequest } from "../auth";
import { userRepo } from "../repositories";
import { recordActivity } from "../services/activity.service";
import type { AppEnv } from "../types/http";

/**
 * Resolve the request's session (cookie or bearer) into our domain user and put
 * it on `c.var.user`. Non-fatal: anonymous requests pass through with no user —
 * `require-auth` is what enforces presence on protected routers.
 *
 * Plain lookup only — no user creation. The domain profile is provisioned at
 * login time (magic-link / OAuth). A valid JWT with no matching `users` row
 * means the user was deleted; leaving `c.var.user` unset lets `require-auth`
 * return 401 as intended.
 */
export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const principal = await verifyRequest(c.req.raw.headers);
  if (principal) {
    const user = await userRepo.findByAuthSubjectId(principal.subjectId);
    if (user) {
      c.set("user", user);
      // Fire-and-forget: throttled + self-contained, never gates the response.
      void recordActivity(user.id);
    }
  }
  await next();
});

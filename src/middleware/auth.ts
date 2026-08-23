import { createMiddleware } from "hono/factory";
import { verifyRequest } from "../auth";
import { userRepo } from "../repositories";
import { resolveUser } from "../services/identity.service";
import { recordActivity } from "../services/activity.service";
import { accountErasureRepo } from "../repositories";
import { identityDigest } from "../services/account-erasure.service";
import type { AppEnv } from "../types/http";

/**
 * Resolve the request's session (cookie or bearer) into our domain user and put
 * it on `c.var.user`. Non-fatal: anonymous requests pass through with no user —
 * `require-auth` is what enforces presence on protected routers.
 *
 * When `findByAuthSubjectId` finds no matching row (webhook race: Clerk fired the
 * JWT before the `user.created` webhook landed), `resolveUser` is called inline
 * as a fallback to provision the domain profile on demand. Both paths are
 * idempotent so a subsequent webhook delivery is a safe no-op.
 */
export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const principal = await verifyRequest(c.req.raw.headers);
  if (principal) {
    c.set("principal", principal);
    if (await accountErasureRepo.hasActiveTombstone("clerk", identityDigest(principal.subjectId))) {
      await next();
      return;
    }
    let user = await userRepo.findByAuthSubjectId(principal.subjectId);
    if (!user) {
      const resolved = await resolveUser(principal);
      user = resolved.user;
    }
    if (user) {
      c.set("user", user);
      // Fire-and-forget: throttled + self-contained, never gates the response.
      void recordActivity(user.id);
    }
  }
  await next();
});

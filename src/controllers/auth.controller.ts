import type { Context } from "hono";
import { ok } from "../lib/response";
import { magicLinkRequestSchema, magicLinkVerifySchema, type AuthSession } from "../auth/schemas";
import { requestMagicLink, verifyMagicLink } from "../auth/magic-link.service";
import type { IssuedTokens } from "../auth/session.service";
import { sessionContext } from "../auth/request-context";
import type { AppEnv } from "../types/http";

function toAuthSession(tokens: IssuedTokens): AuthSession {
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    refreshExpiresAt: tokens.refreshExpiresAt.toISOString(),
  };
}

/**
 * POST /auth/magic-link/request — email a sign-in link. Always 202 with a
 * generic body: the response never reveals whether the address has an account
 * (no user enumeration). `validate` has already parsed + lowercased the email.
 */
export async function postMagicLinkRequest(c: Context<AppEnv>) {
  const { email } = magicLinkRequestSchema.parse((c.req.valid as (t: "json") => unknown)("json"));
  await requestMagicLink(email);
  return c.json(ok({ status: "sent" }), 202);
}

/**
 * POST /auth/magic-link/verify — redeem the token from the deep link and return
 * the access + refresh pair. 401 when the token is invalid/expired/used.
 */
export async function postMagicLinkVerify(c: Context<AppEnv>) {
  const { token } = magicLinkVerifySchema.parse((c.req.valid as (t: "json") => unknown)("json"));
  const tokens = await verifyMagicLink(token, sessionContext(c));
  return c.json(ok(toAuthSession(tokens)));
}

import { db } from "../../../db";
import { getRedis } from "../../lib/redis";
import { newId } from "../../lib/ids";
import { env } from "../../env";
import { UnauthorizedError } from "../../lib/errors";
import { accountRepo, authIdentityRepo } from "../../repositories";
import { randomToken, sha256Base64Url } from "../crypto";
import {
  issueSession,
  principalOf,
  type IssuedTokens,
  type SessionContext,
} from "../session.service";
import { resolveUser } from "../../services/identity.service";
import { sendWelcomeEmail } from "../emails";
import { exchangeCodeForIdToken, googleRedirectUri, verifyIdToken } from "./google.client";

const PROVIDER = "google";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const STATE_TTL_SEC = 600;
const stateKey = (state: string) => `oauth:google:${state}`;

/** Google is usable only when both halves of the credential pair are present. */
export function isGoogleConfigured(): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

/**
 * Begin sign-in: mint `state` (CSRF) + a PKCE verifier, stash the verifier in
 * Redis keyed by state (short TTL), and return Google's consent URL. PKCE (S256)
 * is mandatory for a public mobile client — the verifier never leaves our server.
 */
export async function startGoogleSignIn(): Promise<string> {
  const state = randomToken(16);
  const codeVerifier = randomToken(32);
  await getRedis().set(stateKey(state), codeVerifier, "EX", STATE_TTL_SEC);

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: sha256Base64Url(codeVerifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/**
 * Complete sign-in from the callback: validate state (GETDEL — single use, defeats
 * CSRF + replay), exchange the code for an id_token, verify it against Google's
 * JWKS, then upsert identity + link the Google account + issue a session in one
 * transaction. Requires a Google-verified email.
 */
export async function completeGoogleSignIn(
  code: string,
  state: string,
  ctx: SessionContext = {}
): Promise<IssuedTokens> {
  const codeVerifier = await getRedis().getdel(stateKey(state));
  if (!codeVerifier) throw new UnauthorizedError("Invalid or expired sign-in attempt");

  const idToken = await exchangeCodeForIdToken(code, codeVerifier);
  const claims = await verifyIdToken(idToken);
  if (!claims.emailVerified) throw new UnauthorizedError("Your Google email is not verified");

  let created = false;
  let newUserId = "";
  const tokens = await db.transaction(async (tx) => {
    const identity = await authIdentityRepo.upsertByEmail(
      {
        email: claims.email,
        name: claims.name ?? claims.email.split("@")[0] ?? "Thrivo user",
        emailVerified: true,
        image: claims.picture ?? null,
      },
      tx
    );

    const linked = await accountRepo.findByProvider(PROVIDER, claims.sub, tx);
    if (!linked) {
      await accountRepo.create(
        { id: newId(), providerId: PROVIDER, accountId: claims.sub, userId: identity.id, idToken },
        tx
      );
    }

    const resolved = await resolveUser(principalOf(identity), tx);
    created = resolved.created;
    newUserId = resolved.user.id;
    return issueSession(principalOf(identity), ctx, tx);
  });

  // Fired after commit, never inside the transaction — see identity.service.ts.
  if (created) await sendWelcomeEmail(claims.email, newUserId);

  return tokens;
}

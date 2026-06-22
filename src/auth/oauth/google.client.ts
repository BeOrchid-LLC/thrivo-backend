import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../../env";
import { UpstreamError } from "../../lib/errors";

/**
 * Thin Google OAuth client: authorization-code → id_token exchange, and id_token
 * verification against Google's JWKS. Isolated from the flow service so the
 * network + crypto boundary can be mocked in tests.
 */
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
// Google still issues both forms of the `iss` claim; accept either.
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

// createRemoteJWKSet caches keys + handles rotation/rate-limiting internally.
const jwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));

export type GoogleIdClaims = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
};

/** The redirect URI Google calls back — must be registered in the Google console. */
export function googleRedirectUri(): string {
  return `${env.AUTH_BASE_URL}/api/v1/auth/google/callback`;
}

/** Exchange an authorization code (+ PKCE verifier) for an OIDC id_token. */
export async function exchangeCodeForIdToken(code: string, codeVerifier: string): Promise<string> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID ?? "",
      client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }),
  });

  if (!res.ok) {
    throw new UpstreamError("Google token exchange failed", { status: res.status });
  }
  const json = (await res.json()) as { id_token?: string };
  if (!json.id_token) throw new UpstreamError("Google response missing id_token");
  return json.id_token;
}

/**
 * Verify an id_token's signature against Google's JWKS and validate issuer +
 * audience (our client id) + expiry. Returns the trusted claims, or throws —
 * a decoded-but-unverified id_token is the classic OAuth hole, so verification
 * is mandatory before we trust the email.
 */
export async function verifyIdToken(idToken: string): Promise<GoogleIdClaims> {
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: GOOGLE_ISSUERS,
    audience: env.GOOGLE_CLIENT_ID ?? "",
  });
  const email = typeof payload.email === "string" ? payload.email : undefined;
  if (!payload.sub || !email) throw new UpstreamError("Google id_token missing sub/email");
  return {
    sub: payload.sub,
    email,
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === "string" ? payload.name : undefined,
    picture: typeof payload.picture === "string" ? payload.picture : undefined,
  };
}

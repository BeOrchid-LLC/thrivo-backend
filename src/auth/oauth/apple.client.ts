import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../../env";
import { UpstreamError } from "../../lib/errors";

/**
 * Thin Apple "Sign in with Apple" client: verifies the native identity token the
 * iOS app obtains from `expo-apple-authentication` against Apple's JWKS. Native
 * Sign in with Apple hands the app a signed `identityToken` (an OIDC id_token)
 * directly, so — unlike Google's web flow — there is no authorization-code
 * exchange; we only verify the token's signature, issuer, audience and expiry.
 */
const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";
const APPLE_ISSUER = "https://appleid.apple.com";

// createRemoteJWKSet caches keys + handles rotation/rate-limiting internally.
const jwks = createRemoteJWKSet(new URL(APPLE_JWKS_URL));

export type AppleIdClaims = {
  sub: string;
  /** Apple only returns email on the first authorization (or never, if hidden). */
  email?: string;
  emailVerified: boolean;
};

/**
 * Verify an Apple identity token's signature against Apple's JWKS and validate
 * issuer + audience (our client id, i.e. the app bundle id) + expiry. Returns the
 * trusted claims or throws — a decoded-but-unverified id_token is the classic
 * OAuth hole, so verification is mandatory before we trust the subject/email.
 */
export async function verifyAppleIdentityToken(identityToken: string): Promise<AppleIdClaims> {
  let payload;
  try {
    ({ payload } = await jwtVerify(identityToken, jwks, {
      issuer: APPLE_ISSUER,
      audience: env.APPLE_CLIENT_ID ?? "",
    }));
  } catch (cause) {
    throw new UpstreamError("Apple identity token verification failed", {
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }

  if (!payload.sub) throw new UpstreamError("Apple identity token missing sub");

  const email = typeof payload.email === "string" ? payload.email : undefined;
  // Apple encodes email_verified as either a boolean or the string "true".
  const emailVerified = payload.email_verified === true || payload.email_verified === "true";

  return { sub: payload.sub, email, emailVerified };
}

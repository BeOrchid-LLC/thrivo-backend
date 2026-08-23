import { resolveUser } from "../../src/services/identity.service";
import { newId } from "../../src/lib/ids";
import type { AuthPrincipal } from "../../src/auth";

export type TestSession = { email: string; accessToken: string };

/**
 * Create a verified, signed-in test user and return a usable access token.
 * Inserts the domain profile directly via resolveUser (no email round-trip), and
 * returns a test-format Bearer token accepted by the verifyToken mock configured
 * in tests/helpers/setup-clerk-mock.ts.
 */
export async function createSession(): Promise<TestSession> {
  const email = `${newId()}@test.thrivo.fit`;
  const subjectId = `user_test_${newId()}`;
  const principal: AuthPrincipal = {
    subjectId,
    email,
    emailVerified: true,
    name: "Test User",
    // Test sessions represent a recently reverified Clerk session so account
    // deletion tests exercise the accepted 202 path.
    factorVerificationAge: [0, 0],
  };
  await resolveUser(principal);
  const accessToken = `test-clerk-token:${subjectId}:${email}`;
  return { email, accessToken };
}

/** Header bag attaching the bearer token to a request. */
export const authed = (session: TestSession) => ({
  Authorization: `Bearer ${session.accessToken}`,
});

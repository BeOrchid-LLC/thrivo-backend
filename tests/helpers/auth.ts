import { authIdentityRepo } from "../../src/repositories";
import { issueSession, principalOf } from "../../src/auth/session.service";
import { newId } from "../../src/lib/ids";

export type TestSession = { email: string; accessToken: string };

/**
 * Create a verified, signed-in test user and return a usable access token. Mints
 * a real auth identity + session through the hand-rolled auth layer (no email
 * round-trip), so route tests get an authenticated principal directly.
 */
export async function createSession(): Promise<TestSession> {
  const email = `${newId()}@test.thrivo.fit`;
  const identity = await authIdentityRepo.upsertByEmail({
    email,
    name: "Test User",
    emailVerified: true,
  });
  const { accessToken } = await issueSession(principalOf(identity));
  return { email, accessToken };
}

/** Header bag attaching the bearer token to a request. */
export const authed = (session: TestSession) => ({
  Authorization: `Bearer ${session.accessToken}`,
});

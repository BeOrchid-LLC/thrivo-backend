import { authIdentityRepo } from "../../src/repositories";
import { issueSession, principalOf } from "../../src/auth/session.service";
import { resolveUser } from "../../src/services/identity.service";
import { newId } from "../../src/lib/ids";

export type TestSession = { email: string; accessToken: string };

/**
 * Create a verified, signed-in test user and return a usable access token. Mints
 * a real auth identity + session through the hand-rolled auth layer (no email
 * round-trip), so route tests get an authenticated principal directly.
 *
 * Mirrors the real login transaction: upsert auth_user → resolveUser (provision
 * the domain profile) → issue session. Without resolveUser the users row would
 * not exist and the first authenticated request would return 401.
 */
export async function createSession(): Promise<TestSession> {
  const email = `${newId()}@test.thrivo.fit`;
  const identity = await authIdentityRepo.upsertByEmail({
    email,
    name: "Test User",
    emailVerified: true,
  });
  await resolveUser(principalOf(identity));
  const { accessToken } = await issueSession(principalOf(identity));
  return { email, accessToken };
}

/** Header bag attaching the bearer token to a request. */
export const authed = (session: TestSession) => ({
  Authorization: `Bearer ${session.accessToken}`,
});

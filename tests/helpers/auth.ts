import { eq } from "drizzle-orm";
import { auth } from "../../src/auth/provider";
import { db } from "../../db";
import { auth_user } from "../../db/schema";
import { newId } from "../../src/lib/ids";

export type TestSession = { email: string; cookie: string };

/**
 * Create a verified, signed-in test user and return its session cookie. Uses
 * BetterAuth's server API (sign-up → mark verified in the auth table we own →
 * sign-in), so route tests get a real session without an email round-trip. This
 * is the authenticated-request seam the harness reserved for A1-4.
 */
export async function createSession(): Promise<TestSession> {
  const email = `${newId()}@test.thrivo.fit`;
  const password = "Test-password-123";

  await auth.api.signUpEmail({ body: { email, password, name: "Test User" } });
  await db.update(auth_user).set({ emailVerified: true }).where(eq(auth_user.email, email));

  const res = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  return { email, cookie: res.headers.get("set-cookie") ?? "" };
}

/** Header bag attaching a session cookie to a request. */
export const authed = (session: TestSession) => ({ Cookie: session.cookie });

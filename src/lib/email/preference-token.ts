import { SignJWT, jwtVerify } from "jose";
import { env } from "../../env";

const ISSUER = "thrivo-backend";
const AUDIENCE = "thrivo-email-preferences";
const PURPOSE = "weekly_review";

function key(): Uint8Array {
  return new TextEncoder().encode(env.EMAIL_LINK_SECRET ?? env.AUTH_SECRET);
}

export async function signWeeklyReviewPreferenceToken(userId: string): Promise<string> {
  return new SignJWT({ purpose: PURPOSE, version: 1 })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .sign(key());
}

export async function verifyWeeklyReviewPreferenceToken(token: string): Promise<string> {
  const { payload } = await jwtVerify(token, key(), { issuer: ISSUER, audience: AUDIENCE });
  if (payload.purpose !== PURPOSE || payload.version !== 1 || !payload.sub) {
    throw new Error("Invalid weekly review preference token");
  }
  return payload.sub;
}

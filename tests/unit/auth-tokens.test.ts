import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { signAccessToken, verifyAccessToken } from "../../src/auth/tokens";
import { env } from "../../src/env";

const principal = { subjectId: "auth_123", email: "a@b.com", emailVerified: true, name: "A B" };
const secret = new TextEncoder().encode(env.BETTER_AUTH_SECRET);
const nowSec = () => Math.floor(Date.now() / 1000);

describe("access tokens", () => {
  it("round-trips a principal through sign + verify", async () => {
    const out = await verifyAccessToken(await signAccessToken(principal));
    expect(out).toEqual(principal);
  });

  it("omits name when absent rather than emitting null", async () => {
    const out = await verifyAccessToken(await signAccessToken({ ...principal, name: undefined }));
    expect(out).toEqual({ subjectId: "auth_123", email: "a@b.com", emailVerified: true });
  });

  it("rejects a structurally invalid token", async () => {
    expect(await verifyAccessToken("not.a.jwt")).toBeNull();
  });

  it("rejects an expired token", async () => {
    const expired = await new SignJWT({ email: principal.email, ev: true })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(principal.subjectId)
      .setIssuer("thrivo")
      .setAudience("thrivo-app")
      .setIssuedAt(nowSec() - 3600)
      .setExpirationTime(nowSec() - 1800)
      .sign(secret);
    expect(await verifyAccessToken(expired)).toBeNull();
  });

  it("rejects a token signed with the wrong secret", async () => {
    const forged = await new SignJWT({ email: principal.email, ev: true })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(principal.subjectId)
      .setIssuer("thrivo")
      .setAudience("thrivo-app")
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(new TextEncoder().encode("x".repeat(40)));
    expect(await verifyAccessToken(forged)).toBeNull();
  });

  it("rejects a token minted for a different audience", async () => {
    const wrongAud = await new SignJWT({ email: principal.email, ev: true })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(principal.subjectId)
      .setIssuer("thrivo")
      .setAudience("someone-else")
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(secret);
    expect(await verifyAccessToken(wrongAud)).toBeNull();
  });
});

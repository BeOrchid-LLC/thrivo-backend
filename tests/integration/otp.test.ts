import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, resetDb } from "../helpers/db";
import { buildApp } from "../../src/app";
import { db } from "../../db";
import { auth_user, session } from "../../db/schema";
import { getRedis } from "../../src/lib/redis";
import { sha256Hex } from "../../src/auth/crypto";
import { env } from "../../src/env";

const run = process.env.RUN_DB_TESTS === "1";

type JsonBody = {
  success: boolean;
  data: { accessToken: string; refreshToken: string; email?: string } | null;
  error?: { code: string; message: string };
};

function post(app: ReturnType<typeof buildApp>, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function otpHash(email: string, code: string): string {
  return sha256Hex(`${email.toLowerCase()}:${code}:${env.AUTH_SECRET}`);
}

async function clearOtpKeys() {
  const redis = getRedis();
  const keys = await redis.keys("*otp*");
  if (keys.length > 0) await redis.del(...keys);
}

async function seedOtp(email: string, code: string, ttlSec = 60) {
  await getRedis().set(`auth-otp:${email.toLowerCase()}`, otpHash(email, code), "EX", ttlSec);
}

describe.skipIf(!run)("integration: email otp auth", () => {
  beforeEach(async () => {
    await resetDb();
    await clearOtpKeys();
  });

  afterAll(async () => {
    await clearOtpKeys();
    await closeDb();
  });

  it("request returns a standard 202 envelope without exposing account existence", async () => {
    const res = await post(buildApp(), "/api/v1/auth/otp/request", {
      email: "New@Test.thrivo.fit",
    });

    expect(res.status).toBe(202);
    const body = (await res.json()) as JsonBody;
    expect(body).toMatchObject({
      success: true,
      data: null,
      responseCode: 202,
      message: "OTP sent",
    });
  });

  it("verify redeems a valid code, returns a working bearer, and creates one verified identity", async () => {
    const app = buildApp();
    const email = "otpuser@test.thrivo.fit";
    await seedOtp(email, "123456");

    const res = await post(app, "/api/v1/auth/otp/verify", { email, code: "123456" });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as JsonBody;
    expect(data?.accessToken).toBeTruthy();
    expect(data?.refreshToken).toBeTruthy();

    const users = await db.select().from(auth_user).where(eq(auth_user.email, email));
    expect(users).toHaveLength(1);
    expect(users[0]?.emailVerified).toBe(true);

    const sessions = await db.select().from(session).where(eq(session.userId, users[0]!.id));
    expect(sessions).toHaveLength(1);

    const me = await app.request("/api/v1/users/me", {
      headers: { authorization: `Bearer ${data?.accessToken}` },
    });
    expect(me.status).toBe(200);
    expect(((await me.json()) as JsonBody).data?.email).toBe(email);
  });

  it("rejects a replayed code", async () => {
    const app = buildApp();
    const email = "replay@test.thrivo.fit";
    await seedOtp(email, "234567");

    expect((await post(app, "/api/v1/auth/otp/verify", { email, code: "234567" })).status).toBe(
      200
    );
    expect((await post(app, "/api/v1/auth/otp/verify", { email, code: "234567" })).status).toBe(
      401
    );
  });

  it("rejects an expired code", async () => {
    const app = buildApp();
    const email = "expired@test.thrivo.fit";
    await seedOtp(email, "345678", 1);
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const res = await post(app, "/api/v1/auth/otp/verify", { email, code: "345678" });
    expect(res.status).toBe(401);
    expect(((await res.json()) as JsonBody).error?.code).toBe("UNAUTHENTICATED");
  });

  it("applies wrong-code backoff with Retry-After", async () => {
    const app = buildApp();
    const email = "backoff@test.thrivo.fit";
    await seedOtp(email, "456789");

    const wrong = await post(app, "/api/v1/auth/otp/verify", { email, code: "000000" });
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("Retry-After")).toBe("30");

    const duringBackoff = await post(app, "/api/v1/auth/otp/verify", { email, code: "456789" });
    expect(duringBackoff.status).toBe(429);
    expect(duringBackoff.headers.get("Retry-After")).toBeTruthy();
    expect(((await duringBackoff.json()) as JsonBody).error?.code).toBe("RATE_LIMITED");
  });

  it("locks after repeated wrong-code attempts", async () => {
    const app = buildApp();
    const email = "locked@test.thrivo.fit";
    const redis = getRedis();

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await seedOtp(email, "567890");
      await redis.del(`auth-otp-backoff:${email}`);
      await post(app, "/api/v1/auth/otp/verify", { email, code: "111111" });
    }

    const locked = await post(app, "/api/v1/auth/otp/verify", { email, code: "567890" });
    expect(locked.status).toBe(429);
    expect(locked.headers.get("Retry-After")).toBeTruthy();
    expect(((await locked.json()) as JsonBody).error?.message).toContain("locked");
  });
});

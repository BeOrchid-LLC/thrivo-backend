import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import { buildApp } from "../../src/app";
import { env } from "../../src/env";
import { getRedis } from "../../src/lib/redis";
import { signAdminSession, ADMIN_COOKIE } from "../../src/admin/session.service";
import { issueAdminOtp } from "../../src/admin/otp.service";

const run = process.env.RUN_DB_TESTS === "1";

const ALLOWED_ORIGIN = env.CORS_ORIGINS[0] ?? "http://localhost:3001";

async function clearOtpKeys() {
  const redis = getRedis();
  const keys = await redis.keys("*otp*");
  if (keys.length > 0) await redis.del(...keys);
}

function post(app: ReturnType<typeof buildApp>, path: string, body: unknown, headers = {}) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function adminCookie(): Promise<string> {
  const token = await signAdminSession({
    id: "admin@test.thrivo.fit",
    email: "admin@test.thrivo.fit",
    name: null,
    role: "admin",
  });
  return `${ADMIN_COOKIE}=${token}`;
}

describe.skipIf(!run)("integration: admin auth security (R3-2, R3-3)", () => {
  beforeEach(async () => {
    await resetDb();
    await clearOtpKeys();
  });
  afterAll(async () => {
    await clearOtpKeys();
    await closeDb();
  });

  it("throttles the 6th OTP issue for one email within 15 minutes (R3-2, I6)", async () => {
    // Exercises the real Redis-backed throttle directly on the OTP service —
    // CI doesn't configure ADMIN_EMAILS, so going through the HTTP endpoint
    // would short-circuit at the allowlist check before ever calling issue().
    const email = "throttle-target@test.thrivo.fit";

    for (let i = 0; i < 5; i += 1) {
      expect(await issueAdminOtp(email)).toMatch(/^\d{6}$/);
    }

    // 6th issue in the window is throttled — null, not a thrown error.
    expect(await issueAdminOtp(email)).toBeNull();
  });

  it("request-otp always returns the same 202 envelope regardless of throttle state (no enumeration)", async () => {
    const app = buildApp();
    const res = await post(app, "/api/v1/admin/auth/request-otp", {
      email: "whoever@test.thrivo.fit",
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { success: boolean; message: string };
    expect(body).toMatchObject({ success: true, message: "OTP sent" });
  });

  it("rejects a cross-site cookie-authed POST with no Origin header (I9)", async () => {
    const app = buildApp();
    const cookie = await adminCookie();

    const res = await app.request("/api/v1/admin/auth/logout", {
      method: "POST",
      headers: { Cookie: cookie }, // no Origin — the forged-form-post shape
    });

    expect(res.status).toBe(403);
  });

  it("allows the same request from the real admin origin", async () => {
    const app = buildApp();
    const cookie = await adminCookie();

    const res = await app.request("/api/v1/admin/auth/logout", {
      method: "POST",
      headers: { Cookie: cookie, Origin: ALLOWED_ORIGIN },
    });

    expect(res.status).toBe(200);
  });
});

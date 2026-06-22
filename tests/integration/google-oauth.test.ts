import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

// Mock only the external Google boundary (network + JWKS); everything else —
// Redis state, DB upsert/link, session issue, the redirect — runs for real.
const { exchangeCodeForIdToken, verifyIdToken } = vi.hoisted(() => ({
  exchangeCodeForIdToken: vi.fn(async () => "fake.id.token"),
  verifyIdToken: vi.fn(),
}));
vi.mock("../../src/auth/oauth/google.client", () => ({
  exchangeCodeForIdToken,
  verifyIdToken,
  googleRedirectUri: () => "http://localhost:4000/api/v1/auth/google/callback",
}));

import { closeDb, resetDb } from "../helpers/db";
import { buildApp } from "../../src/app";
import { db } from "../../db";
import { account, auth_user, session } from "../../db/schema";
import { getRedis } from "../../src/lib/redis";

const run = process.env.RUN_DB_TESTS === "1";

async function seedState(state: string, verifier = "test-verifier") {
  await getRedis().set(`oauth:google:${state}`, verifier, "EX", 600);
}

const claims = (over: Partial<Record<string, unknown>> = {}) => ({
  sub: "google-sub-123",
  email: "goog@test.thrivo.fit",
  emailVerified: true,
  name: "Goog User",
  picture: null,
  ...over,
});

describe.skipIf(!run)("integration: google oauth callback", () => {
  beforeEach(async () => {
    await resetDb();
    verifyIdToken.mockResolvedValue(claims());
  });
  afterEach(() => vi.clearAllMocks());
  afterAll(async () => {
    await closeDb();
  });

  it("redeems a valid callback: links the account, issues a session, returns a working bearer", async () => {
    const app = buildApp();
    await seedState("state-ok");

    const res = await app.request("/api/v1/auth/google/callback?code=abc&state=state-ok");
    expect(res.status).toBe(302);

    const location = res.headers.get("location") ?? "";
    expect(location.startsWith("thrivo://auth?")).toBe(true);
    const params = new URLSearchParams(location.slice(location.indexOf("?") + 1));
    const accessToken = params.get("token");
    expect(accessToken).toBeTruthy();
    expect(params.get("refresh")).toBeTruthy();

    const users = await db
      .select()
      .from(auth_user)
      .where(eq(auth_user.email, "goog@test.thrivo.fit"));
    expect(users).toHaveLength(1);
    const accounts = await db.select().from(account).where(eq(account.accountId, "google-sub-123"));
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.providerId).toBe("google");
    const sessions = await db.select().from(session).where(eq(session.userId, users[0]!.id));
    expect(sessions).toHaveLength(1);

    const me = await app.request("/api/v1/users/me", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { data: { email: string } }).data.email).toBe(
      "goog@test.thrivo.fit"
    );
  });

  it("consumes state once — a replayed callback is rejected (CSRF/replay guard)", async () => {
    const app = buildApp();
    await seedState("state-replay");
    expect(
      (await app.request("/api/v1/auth/google/callback?code=abc&state=state-replay")).status
    ).toBe(302);

    const replay = await app.request("/api/v1/auth/google/callback?code=abc&state=state-replay");
    expect(new URL(replay.headers.get("location") ?? "").searchParams.get("error")).toBe(
      "auth_failed"
    );
  });

  it("rejects an unknown state", async () => {
    const res = await buildApp().request("/api/v1/auth/google/callback?code=abc&state=never-seen");
    expect(new URL(res.headers.get("location") ?? "").searchParams.get("error")).toBe(
      "auth_failed"
    );
  });

  it("rejects a Google-unverified email", async () => {
    verifyIdToken.mockResolvedValue(claims({ emailVerified: false }));
    await seedState("state-unverified");
    const res = await buildApp().request(
      "/api/v1/auth/google/callback?code=abc&state=state-unverified"
    );
    expect(new URL(res.headers.get("location") ?? "").searchParams.get("error")).toBe(
      "auth_failed"
    );
  });

  it("returns the app with access_denied when Google reports a consent error", async () => {
    const res = await buildApp().request(
      "/api/v1/auth/google/callback?error=access_denied&state=x"
    );
    expect(new URL(res.headers.get("location") ?? "").searchParams.get("error")).toBe(
      "access_denied"
    );
  });
});

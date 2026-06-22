import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, resetDb } from "../helpers/db";
import { buildApp } from "../../src/app";
import { db } from "../../db";
import { auth_user, session, verification } from "../../db/schema";
import { sha256Hex } from "../../src/auth/crypto";
import { newId } from "../../src/lib/ids";

// Magic-link flow against a real Postgres + Redis. Gated; enable with RUN_DB_TESTS=1.
const run = process.env.RUN_DB_TESTS === "1";

type JsonBody = { data: { accessToken: string; refreshToken: string; email?: string } };

function post(app: ReturnType<typeof buildApp>, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Seed a verification row directly so the test holds the raw token the email would carry. */
async function seedToken(email: string, rawToken: string, expiresAt: Date) {
  await db.insert(verification).values({
    id: newId(),
    identifier: `magic-link:${email}`,
    value: sha256Hex(rawToken),
    expiresAt,
  });
}

describe.skipIf(!run)("integration: magic link", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeDb();
  });

  it("request returns 202 and persists only a hashed token (never the raw)", async () => {
    const res = await post(buildApp(), "/api/v1/auth/magic-link/request", {
      email: "New@Test.thrivo.fit",
    });
    expect(res.status).toBe(202);

    const rows = await db
      .select()
      .from(verification)
      .where(eq(verification.identifier, "magic-link:new@test.thrivo.fit"));
    expect(rows).toHaveLength(1);
    // Stored value is a 64-char hex SHA-256, not anything resembling the token.
    expect(rows[0]?.value).toMatch(/^[a-f0-9]{64}$/);
  });

  it("verify redeems a valid token, returns a working bearer, and creates one verified identity", async () => {
    const app = buildApp();
    const email = "mluser@test.thrivo.fit";
    const raw = "magic-raw-token-abc";
    await seedToken(email, raw, new Date(Date.now() + 60_000));

    const res = await post(app, "/api/v1/auth/magic-link/verify", { token: raw });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as JsonBody;
    expect(data.accessToken).toBeTruthy();
    expect(data.refreshToken).toBeTruthy();

    const users = await db.select().from(auth_user).where(eq(auth_user.email, email));
    expect(users).toHaveLength(1);
    expect(users[0]?.emailVerified).toBe(true);

    const sessions = await db.select().from(session).where(eq(session.userId, users[0]!.id));
    expect(sessions).toHaveLength(1);

    // The returned access token authenticates a protected route end-to-end.
    const me = await app.request("/api/v1/users/me", {
      headers: { authorization: `Bearer ${data.accessToken}` },
    });
    expect(me.status).toBe(200);
    expect(((await me.json()) as JsonBody).data.email).toBe(email);
  });

  it("rejects a replayed token — one-time-use (no double redemption)", async () => {
    const app = buildApp();
    const raw = "replay-token-xyz";
    await seedToken("replay@test.thrivo.fit", raw, new Date(Date.now() + 60_000));

    expect((await post(app, "/api/v1/auth/magic-link/verify", { token: raw })).status).toBe(200);
    expect((await post(app, "/api/v1/auth/magic-link/verify", { token: raw })).status).toBe(401);
  });

  it("rejects an expired token", async () => {
    const app = buildApp();
    const raw = "expired-token";
    await seedToken("expired@test.thrivo.fit", raw, new Date(Date.now() - 1000));

    expect((await post(app, "/api/v1/auth/magic-link/verify", { token: raw })).status).toBe(401);
  });
});

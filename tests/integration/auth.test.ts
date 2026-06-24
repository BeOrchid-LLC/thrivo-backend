import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import { createSession, authed } from "../helpers/auth";
import { buildApp } from "../../src/app";
import { userRepo } from "../../src/repositories";

// Auth flows + route scoping against a real Postgres (auth tables migrate via the
// same runMigrations). Gated; enable with RUN_DB_TESTS=1.
const run = process.env.RUN_DB_TESTS === "1";

describe.skipIf(!run)("integration: auth", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeDb();
  });

  it("rejects an unauthenticated protected request with 401", async () => {
    const res = await buildApp().request("/api/v1/users/me");
    expect(res.status).toBe(401);
  });

  it("signs a user in and returns their own profile, reconciled to one users row", async () => {
    const app = buildApp();
    const session = await createSession();

    const res = await app.request("/api/v1/users/me", { headers: authed(session) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { email: string } };
    expect(body.data.email).toBe(session.email);

    // The reconcile created exactly one domain profile, linked to the auth subject.
    const user = await userRepo.findActiveByEmail(session.email);
    expect(user?.authSubjectId).toBeTruthy();
  });

  it("scopes the profile per session — a user never sees another's (no IDOR)", async () => {
    const app = buildApp();
    const a = await createSession();
    const b = await createSession();

    const resA = await app.request("/api/v1/users/me", { headers: authed(a) });
    const resB = await app.request("/api/v1/users/me", { headers: authed(b) });

    expect(((await resA.json()) as { data: { email: string } }).data.email).toBe(a.email);
    expect(((await resB.json()) as { data: { email: string } }).data.email).toBe(b.email);
    expect(a.email).not.toBe(b.email);
  });

  it("soft-deletes the caller's account via DELETE /users/me", async () => {
    const app = buildApp();
    const session = await createSession();

    await app.request("/api/v1/users/me", { headers: authed(session) }); // reconcile the profile
    const del = await app.request("/api/v1/users/me", {
      method: "DELETE",
      headers: authed(session),
    });
    expect(del.status).toBe(200);
    const body = (await del.json()) as { success: boolean; data: null };
    expect(body.success).toBe(true);
    expect(body.data).toBeNull();
    expect(await userRepo.findActiveByEmail(session.email)).toBeNull();
  });
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { authed, createSession } from "../helpers/auth";
import { closeDb, resetDb } from "../helpers/db";
import { makeTestApp } from "../helpers/app";
import { userRepo } from "../../src/repositories";

const run = process.env.RUN_DB_TESTS === "1";

describe.skipIf(!run)("integration: dashboard tier gating", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("blocks free users from macros but allows calories", async () => {
    const app = makeTestApp();
    const session = await createSession();

    const macros = await app.request("/api/v1/dashboard/macros?date=2026-06-28", {
      headers: authed(session),
    });
    expect(macros.status).toBe(403);
    const macrosBody = await macros.json();
    expect(macrosBody.error.code).toBe("PREMIUM_REQUIRED");

    const calories = await app.request("/api/v1/dashboard/calories?date=2026-06-28", {
      headers: authed(session),
    });
    expect(calories.status).toBe(200);
  });

  it("allows premium users to read macros", async () => {
    const app = makeTestApp();
    const session = await createSession();
    const user = await userRepo.findActiveByEmail(session.email);
    expect(user).not.toBeNull();
    await userRepo.updateProfile(user!.id, { tier: "premium" });

    const macros = await app.request("/api/v1/dashboard/macros?date=2026-06-28", {
      headers: authed(session),
    });
    expect(macros.status).toBe(200);
  });
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import { buildApp } from "../../src/app";
import { env } from "../../src/env";
import { makeAdminUser, makeUser } from "../helpers/factories";

const run = process.env.RUN_DB_TESTS === "1";
const ALLOWED_ORIGIN = env.CORS_ORIGINS[0] ?? "http://localhost:3001";

function bearerFor(role: "admin" | "support" | "read-only") {
  return `Bearer test-clerk-admin-token:test_${role.replace(/-/g, "")}:${role}@test.thrivo.fit`;
}

const jsonHeaders = (bearer: string) => ({
  authorization: bearer,
  Origin: ALLOWED_ORIGIN,
  "Content-Type": "application/json",
});

describe.skipIf(!run)("integration: admin RBAC capability gates", () => {
  beforeEach(async () => {
    await resetDb();
    await Promise.all([
      makeAdminUser("admin@test.thrivo.fit", "admin"),
      makeAdminUser("support@test.thrivo.fit", "support"),
      makeAdminUser("read-only@test.thrivo.fit", "read-only"),
    ]);
  });
  afterAll(async () => {
    await closeDb();
  });

  it("read-only can read but cannot mutate anything", async () => {
    const app = buildApp();
    const bearer = bearerFor("read-only");

    const read = await app.request("/api/v1/admin/tips", { headers: { authorization: bearer } });
    expect(read.status).toBe(200);

    const createTip = await app.request("/api/v1/admin/tips", {
      method: "POST",
      headers: jsonHeaders(bearer),
      body: JSON.stringify({ body: "nope", isActive: true }),
    });
    expect(createTip.status).toBe(403);
  });

  it("support can manage content but not destructive/money actions", async () => {
    const app = buildApp();
    const bearer = bearerFor("support");

    const createTip = await app.request("/api/v1/admin/tips", {
      method: "POST",
      headers: jsonHeaders(bearer),
      body: JSON.stringify({ body: "Be kind.", isActive: true }),
    });
    expect(createTip.status).toBe(201);

    const user = await makeUser({ tier: "premium" });
    const refund = await app.request(`/api/v1/admin/users/${user.id}/subscription/refund`, {
      method: "POST",
      headers: jsonHeaders(bearer),
      body: JSON.stringify({ reason: "x" }),
    });
    expect(refund.status).toBe(403);

    const del = await app.request(`/api/v1/admin/users/${user.id}`, {
      method: "DELETE",
      headers: { authorization: bearer, Origin: ALLOWED_ORIGIN },
    });
    expect(del.status).toBe(403);
  });

  it("admin can perform destructive actions", async () => {
    const app = buildApp();
    const bearer = bearerFor("admin");
    const user = await makeUser();

    const del = await app.request(`/api/v1/admin/users/${user.id}`, {
      method: "DELETE",
      headers: { authorization: bearer, Origin: ALLOWED_ORIGIN },
    });
    expect(del.status).toBe(200);
  });
});

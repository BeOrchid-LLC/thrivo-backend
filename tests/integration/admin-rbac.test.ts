import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import { buildApp } from "../../src/app";
import { env } from "../../src/env";
import { signAdminSession, ADMIN_COOKIE } from "../../src/admin/session.service";
import { makeUser } from "../helpers/factories";

const run = process.env.RUN_DB_TESTS === "1";
const ALLOWED_ORIGIN = env.CORS_ORIGINS[0] ?? "http://localhost:3001";

async function cookieFor(role: "admin" | "support" | "read-only"): Promise<string> {
  const token = await signAdminSession({
    id: `${role}@test.thrivo.fit`,
    email: `${role}@test.thrivo.fit`,
    name: null,
    role,
  });
  return `${ADMIN_COOKIE}=${token}`;
}

const jsonHeaders = (cookie: string) => ({
  Cookie: cookie,
  Origin: ALLOWED_ORIGIN,
  "Content-Type": "application/json",
});

describe.skipIf(!run)("integration: admin RBAC capability gates", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeDb();
  });

  it("read-only can read but cannot mutate anything", async () => {
    const app = buildApp();
    const cookie = await cookieFor("read-only");

    const read = await app.request("/api/v1/admin/tips", { headers: { cookie } });
    expect(read.status).toBe(200);

    const createTip = await app.request("/api/v1/admin/tips", {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ body: "nope", isActive: true }),
    });
    expect(createTip.status).toBe(403);
  });

  it("support can manage content but not destructive/money actions", async () => {
    const app = buildApp();
    const cookie = await cookieFor("support");

    const createTip = await app.request("/api/v1/admin/tips", {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ body: "Be kind.", isActive: true }),
    });
    expect(createTip.status).toBe(201);

    const user = await makeUser({ tier: "premium" });
    const refund = await app.request(`/api/v1/admin/users/${user.id}/subscription/refund`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ reason: "x" }),
    });
    expect(refund.status).toBe(403);

    const del = await app.request(`/api/v1/admin/users/${user.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie, Origin: ALLOWED_ORIGIN },
    });
    expect(del.status).toBe(403);
  });

  it("admin can perform destructive actions", async () => {
    const app = buildApp();
    const cookie = await cookieFor("admin");
    const user = await makeUser();

    const del = await app.request(`/api/v1/admin/users/${user.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie, Origin: ALLOWED_ORIGIN },
    });
    expect(del.status).toBe(200);
  });
});

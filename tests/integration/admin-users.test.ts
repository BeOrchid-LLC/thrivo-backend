import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import { createSession } from "../helpers/auth";
import { buildApp } from "../../src/app";
import { signAdminSession, ADMIN_COOKIE } from "../../src/admin/session.service";
import { userRepo } from "../../src/repositories";

const run = process.env.RUN_DB_TESTS === "1";

async function adminCookie(): Promise<string> {
  const token = await signAdminSession({
    id: "admin@test.thrivo.fit",
    email: "admin@test.thrivo.fit",
    name: null,
    role: "admin",
  });
  return `${ADMIN_COOKIE}=${token}`;
}

describe.skipIf(!run)("integration: admin users", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeDb();
  });

  it("hard-deletes a user via DELETE /admin/users/:id with a JSON ack envelope", async () => {
    const app = buildApp();
    const session = await createSession();

    const user = await userRepo.findActiveByEmail(session.email);
    expect(user).not.toBeNull();

    const del = await app.request(`/api/v1/admin/users/${user!.id}`, {
      method: "DELETE",
      headers: { Cookie: await adminCookie() },
    });

    expect(del.status).toBe(200);
    const body = (await del.json()) as { success: boolean; data: null; message: string };
    expect(body.success).toBe(true);
    expect(body.data).toBeNull();
    expect(body.message).toBe("User deleted permanently");
    expect(await userRepo.findActiveByEmail(session.email)).toBeNull();
  });
});

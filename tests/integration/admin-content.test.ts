import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import { buildApp } from "../../src/app";
import { db } from "../../db";
import { env } from "../../src/env";
import { adminAuditLog, tips } from "../../db/schema";
import { makeAdminUser } from "../helpers/factories";
import { adminPaginated, adminTipSchema } from "../../contracts/src";

const run = process.env.RUN_DB_TESTS === "1";
const ALLOWED_ORIGIN = env.CORS_ORIGINS[0] ?? "http://localhost:3001";

function adminBearer() {
  return "Bearer test-clerk-token:test_admin:admin@test.thrivo.fit";
}

describe.skipIf(!run)("integration: admin content (tips)", () => {
  beforeEach(async () => {
    await resetDb();
    await makeAdminUser("admin@test.thrivo.fit", "admin");
  });
  afterAll(async () => {
    await closeDb();
  });

  it("creates a tip (POST /admin/tips) and writes exactly one audit row", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/tips", {
      method: "POST",
      headers: {
        authorization: adminBearer(),
        Origin: ALLOWED_ORIGIN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body: "Be kind to yourself.", mood: "okay", isActive: true }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: unknown };
    const parsed = adminTipSchema.safeParse((body.data as { tip: unknown }).tip);
    expect(parsed.success).toBe(true);
    // The admin "okay" label round-trips to the DB "ok" mood enum.
    if (parsed.success) expect(parsed.data.mood).toBe("okay");

    const auditRows = await db
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, "tip.create"));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      actorAdminEmail: "admin@test.thrivo.fit",
      targetType: "tip",
    });
  });

  it("lists tips in the offset-paginated contract shape", async () => {
    await db.insert(tips).values([
      { body: "Tip one", isActive: true },
      { body: "Tip two", isActive: true },
    ]);
    const app = buildApp();
    const res = await app.request("/api/v1/admin/tips?page=1&pageSize=10", {
      headers: { authorization: adminBearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown };
    const parsed = adminPaginated(adminTipSchema).safeParse(body.data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.pagination.total).toBe(2);
      expect(parsed.data.items).toHaveLength(2);
    }
  });

  it("updates then deletes a tip, auditing each mutation", async () => {
    const [tip] = await db.insert(tips).values({ body: "Original", isActive: true }).returning();
    const app = buildApp();

    const patch = await app.request(`/api/v1/admin/tips/${tip.id}`, {
      method: "PATCH",
      headers: {
        authorization: adminBearer(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body: "Edited", isActive: false }),
    });
    expect(patch.status).toBe(200);

    const del = await app.request(`/api/v1/admin/tips/${tip.id}`, {
      method: "DELETE",
      headers: { authorization: adminBearer() },
    });
    expect(del.status).toBe(200);

    const actions = await db.select().from(adminAuditLog).where(eq(adminAuditLog.targetId, tip.id));
    const names = actions.map((a) => a.action).sort();
    expect(names).toEqual(["tip.delete", "tip.update"]);
  });

  it("rejects an unauthenticated request", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/tips");
    expect(res.status).toBe(401);
  });
});

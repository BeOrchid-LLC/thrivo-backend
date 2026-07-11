import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import { buildApp } from "../../src/app";
import { db } from "../../db";
import { adminAuditLog } from "../../db/schema";
import { signAdminSession, ADMIN_COOKIE } from "../../src/admin/session.service";
import { emailCaptureRepo } from "../../src/repositories";

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

describe.skipIf(!run)("integration: admin leads", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeDb();
  });

  it("hard-deletes a lead via DELETE /admin/leads/:id and writes exactly one audit row (R3-1)", async () => {
    const app = buildApp();
    const lead = await emailCaptureRepo.capture({
      email: "spam@test.thrivo.fit",
      source: "cta",
      country: null,
      deviceType: null,
      osName: null,
      osVersion: null,
      browserName: null,
      browserVersion: null,
      rawUserAgent: null,
      referrer: null,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
    });

    const del = await app.request(`/api/v1/admin/leads/${lead.id}`, {
      method: "DELETE",
      headers: { Cookie: await adminCookie() },
    });

    expect(del.status).toBe(200);
    const body = (await del.json()) as { success: boolean; data: null; message: string };
    expect(body.success).toBe(true);
    expect(body.message).toBe("Lead deleted permanently");

    const auditRows = await db
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.targetId, lead.id));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      actorAdminEmail: "admin@test.thrivo.fit",
      action: "lead.hard_delete",
      targetType: "lead",
      targetId: lead.id,
    });
    expect((auditRows[0]!.before as { email: string }).email).toBe("spam@test.thrivo.fit");
  });

  it("deleting a nonexistent lead is a no-op ack and writes no audit row", async () => {
    const app = buildApp();
    const missingId = "00000000-0000-0000-0000-000000000000";

    const del = await app.request(`/api/v1/admin/leads/${missingId}`, {
      method: "DELETE",
      headers: { Cookie: await adminCookie() },
    });

    expect(del.status).toBe(200);
    const auditRows = await db
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.targetId, missingId));
    expect(auditRows).toHaveLength(0);
  });
});

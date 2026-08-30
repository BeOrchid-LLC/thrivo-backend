import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import { buildApp } from "../../src/app";
import { db } from "../../db";
import { env } from "../../src/env";
import { adminAuditLog } from "../../db/schema";
import { makeAdminUser } from "../helpers/factories";
import { emailCaptureRepo } from "../../src/repositories";
import { makeUser } from "../helpers/factories";
import { adminLeadDetailResponseSchema } from "../../contracts/src/leads";

const run = process.env.RUN_DB_TESTS === "1";
const ALLOWED_ORIGIN = env.CORS_ORIGINS[0] ?? "http://localhost:3001";

function adminBearer() {
  return "Bearer test-clerk-admin-token:test_admin:admin@test.thrivo.fit";
}

const jsonHeaders = {
  authorization: adminBearer(),
  Origin: ALLOWED_ORIGIN,
  "Content-Type": "application/json",
};

describe.skipIf(!run)("integration: admin leads", () => {
  beforeEach(async () => {
    await resetDb();
    await makeAdminUser("admin@test.thrivo.fit", "admin");
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
      headers: { authorization: adminBearer(), Origin: ALLOWED_ORIGIN },
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
    expect(auditRows[0]!.before).toEqual({
      leadId: lead.id,
      status: "new",
      reconciledUserId: null,
    });
  });

  it("deleting a nonexistent lead is a no-op ack and writes no audit row", async () => {
    const app = buildApp();
    const missingId = "00000000-0000-0000-0000-000000000000";

    const del = await app.request(`/api/v1/admin/leads/${missingId}`, {
      method: "DELETE",
      headers: { authorization: adminBearer(), Origin: ALLOWED_ORIGIN },
    });

    expect(del.status).toBe(200);
    const auditRows = await db
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.targetId, missingId));
    expect(auditRows).toHaveLength(0);
  });

  it("supports CRM updates, notes, filtered reconciliation, and email-verified linking", async () => {
    const leadEmail = "crm@test.thrivo.fit";
    const lead = await emailCaptureRepo.capture({
      email: leadEmail,
      source: "landing",
      country: "NG",
      deviceType: "desktop",
      osName: "Windows",
      osVersion: null,
      browserName: "Chrome",
      browserVersion: null,
      rawUserAgent: null,
      referrer: null,
      utmSource: "launch",
      utmMedium: null,
      utmCampaign: null,
    });
    const user = await makeUser({ email: leadEmail });
    const app = buildApp();

    const filtered = await app.request("/api/v1/admin/leads?reconciled=false", {
      headers: { authorization: adminBearer() },
    });
    expect(filtered.status).toBe(200);
    const filteredBody = (await filtered.json()) as { data: { items: Array<{ id: string }> } };
    expect(filteredBody.data.items.some((item) => item.id === lead.id)).toBe(true);

    const update = await app.request(`/api/v1/admin/leads/${lead.id}`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({
        status: "qualified",
        ownerAdminEmail: "owner@test.thrivo.fit",
        tags: ["launch", "priority"],
      }),
    });
    expect(update.status).toBe(200);

    const note = await app.request(`/api/v1/admin/leads/${lead.id}/notes`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ body: "Ready for the launch update." }),
    });
    expect(note.status).toBe(201);

    const linked = await app.request(`/api/v1/admin/leads/${lead.id}/link-user`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ userId: user.id }),
    });
    expect(linked.status).toBe(200);
    const linkedBody = (await linked.json()) as { data: unknown };
    const parsed = adminLeadDetailResponseSchema.safeParse(linkedBody.data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.lead.reconciledUserId).toBe(user.id);
      expect(parsed.data.lead.status).toBe("converted");
      expect(parsed.data.lead.notes).toHaveLength(1);
      expect(parsed.data.lead.linkedUser).toMatchObject({ id: user.id, email: leadEmail });
      expect(parsed.data.lead.recentEmails).toEqual([]);
    }

    const actions = await db
      .select({ action: adminAuditLog.action })
      .from(adminAuditLog)
      .where(eq(adminAuditLog.targetId, lead.id));
    expect(actions.map((row) => row.action)).toEqual(
      expect.arrayContaining(["lead.update", "lead.note_add", "lead.link_user"])
    );
  });
});

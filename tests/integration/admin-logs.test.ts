import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import { buildApp } from "../../src/app";
import { db } from "../../db";
import { adminAuditLog } from "../../db/schema";
import { makeAdminUser } from "../helpers/factories";
import { adminAuditLogRepo, emailLogRepo } from "../../src/repositories";
import {
  adminAuditLogDetailResponseSchema,
  adminEmailLogDetailResponseSchema,
} from "../../contracts/src/admin-logs";

const run = process.env.RUN_DB_TESTS === "1";
const adminBearer = "Bearer test-clerk-admin-token:test_admin:admin@test.thrivo.fit";

describe.skipIf(!run)("integration: admin logs", () => {
  beforeEach(async () => {
    await resetDb();
    await makeAdminUser("admin@test.thrivo.fit", "admin");
  });

  afterAll(async () => {
    await closeDb();
  });

  it("returns email-log detail with resend lineage fields", async () => {
    const emailLog = await emailLogRepo.logSend({
      toEmail: "delivery@test.thrivo.fit",
      template: "notification",
      kind: "welcome",
      status: "failed",
      failureCode: "provider_failed",
      error: "provider failure",
    });
    const app = buildApp();

    const response = await app.request(`/api/v1/admin/email-logs/${emailLog.id}`, {
      headers: { authorization: adminBearer },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { emailLog: unknown; data?: { emailLog: unknown } };
    const parsed = adminEmailLogDetailResponseSchema.safeParse(body.data ?? body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.emailLog.id).toBe(emailLog.id);
      expect(parsed.data.emailLog.status).toBe("failed");
      expect(parsed.data.emailLog.resendHistory).toEqual([]);
    }
  });

  it("redacts sensitive audit metadata in detail and CSV export", async () => {
    const audit = await adminAuditLogRepo.append({
      actorAdminEmail: "admin@test.thrivo.fit",
      action: "email.test",
      targetType: "email_log",
      targetId: "email-log-target",
      before: { email: "secret@example.com", status: "failed" },
      after: { body: "private message", outcome: "queued" },
      requestId: "request-logs-1",
      ip: "127.0.0.1",
    });
    const app = buildApp();

    const detailResponse = await app.request(`/api/v1/admin/audit-log/${audit.id}`, {
      headers: { authorization: adminBearer },
    });
    expect(detailResponse.status).toBe(200);
    const detailBody = (await detailResponse.json()) as { data: unknown };
    const detail = adminAuditLogDetailResponseSchema.safeParse(detailBody.data);
    expect(detail.success).toBe(true);
    if (detail.success) {
      expect(detail.data.entry.before).toEqual({ email: "[redacted]", status: "failed" });
      expect(detail.data.entry.after).toEqual({ body: "[redacted]", outcome: "queued" });
    }

    const exportResponse = await app.request(
      "/api/v1/admin/audit-log/export?targetId=email-log-target",
      { headers: { authorization: adminBearer } }
    );
    expect(exportResponse.status).toBe(200);
    const csv = await exportResponse.text();
    expect(csv).toContain("email.test");
    expect(csv).not.toContain("secret@example.com");
    expect(csv).not.toContain("private message");

    const rows = await db.select().from(adminAuditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.before).toEqual({ email: "[redacted]", status: "failed" });
  });
});

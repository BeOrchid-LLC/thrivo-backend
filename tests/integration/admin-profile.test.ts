import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import { buildApp } from "../../src/app";
import { adminAccountRepo, adminAuditLogRepo } from "../../src/repositories";
import { handleAdminClerkWebhookEvent } from "../../src/services/admin-clerk-webhook.service";
import { adminAuditLog } from "../../db/schema";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import {
  adminSelfProfileResponseSchema,
  adminSelfProfileActivityResponseSchema,
} from "../../contracts/src";
import { makeAdminUser } from "../helpers/factories";

const run = process.env.RUN_DB_TESTS === "1";

function bearer(email: string, subject = "test_admin") {
  return `Bearer test-clerk-admin-token:${subject}:${email}`;
}

describe.skipIf(!run)("integration: admin self-profile", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("returns the authoritative profile and effective role permissions", async () => {
    const admin = await makeAdminUser("admin@test.thrivo.fit", "admin", "Admin User");
    const app = buildApp();

    const response = await app.request("/api/v1/admin/auth/profile", {
      headers: { authorization: bearer(admin.email) },
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as { data: unknown };
    const parsed = adminSelfProfileResponseSchema.safeParse(body.data);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.admin).toMatchObject({
      id: admin.id,
      email: admin.email,
      role: "admin",
      status: "active",
      permissionSource: "role",
      authProvider: "clerk",
    });
    expect(parsed.data.admin.effectivePermissions).toContain("users.manage");
    expect(parsed.data.admin.effectivePermissions).toContain("settings.manage");
  });

  it("scopes profile activity to the authenticated admin", async () => {
    const admin = await makeAdminUser("admin@test.thrivo.fit", "admin");
    await adminAuditLogRepo.append({
      actorAdminEmail: admin.email,
      action: "tip.update",
      targetType: "tip",
      targetId: "tip-1",
      requestId: null,
      ip: null,
    });
    await adminAuditLogRepo.append({
      actorAdminEmail: "other@test.thrivo.fit",
      action: "users.delete",
      targetType: "user",
      targetId: "user-1",
      requestId: null,
      ip: null,
    });
    const app = buildApp();

    const response = await app.request("/api/v1/admin/auth/profile/activity", {
      headers: { authorization: bearer(admin.email) },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown };
    const parsed = adminSelfProfileActivityResponseSchema.parse(body.data);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]?.actorEmail).toBe(admin.email);
  });

  it("forbids profile activity when audit.read is removed", async () => {
    const admin = await makeAdminUser("admin@test.thrivo.fit", "admin");
    await adminAccountRepo.update(admin.id, { permissions: [] });
    const app = buildApp();

    const response = await app.request("/api/v1/admin/auth/profile/activity", {
      headers: { authorization: bearer(admin.email) },
    });
    expect(response.status).toBe(403);
  });

  it("records Clerk sessions once and updates lastLoginAt from the provider event", async () => {
    const admin = await makeAdminUser("admin@test.thrivo.fit", "admin");
    await adminAccountRepo.linkClerkAdminId(admin.id, "clerk_admin_1");

    const event = {
      type: "session.created",
      timestamp: 1780000000000,
      data: {
        id: "sess_1",
        user_id: "clerk_admin_1",
        created_at: 1780000000000,
      },
    };

    await expect(handleAdminClerkWebhookEvent(event, "svix_session_1")).resolves.toBe("processed");
    await expect(handleAdminClerkWebhookEvent(event, "svix_session_1")).resolves.toBe("duplicate");

    const updated = await adminAccountRepo.findById(admin.id);
    expect(updated?.lastLoginAt?.getTime()).toBe(1780000000000);
    const loginAudit = await db
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, "admin.login"));
    expect(loginAudit).toHaveLength(1);
  });
});

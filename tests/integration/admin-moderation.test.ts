import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import { buildApp } from "../../src/app";
import { db } from "../../db";
import { env } from "../../src/env";
import { adminAuditLog, checkIns, uploads } from "../../db/schema";
import { makeAdminUser, makeUser, makeCheckIn } from "../helpers/factories";
import { userRepo } from "../../src/repositories";
import {
  adminCheckinNoteListResponseSchema,
  adminUploadListResponseSchema,
} from "../../contracts/src";

const run = process.env.RUN_DB_TESTS === "1";
const ALLOWED_ORIGIN = env.CORS_ORIGINS[0] ?? "http://localhost:3001";

function bearerFor(role: "admin" | "support" | "read-only") {
  return `Bearer test-clerk-admin-token:test_${role.replace(/-/g, "")}:${role}@test.thrivo.fit`;
}

const headers = (bearer: string) => ({ authorization: bearer, Origin: ALLOWED_ORIGIN });

describe.skipIf(!run)("integration: admin UGC moderation", () => {
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

  it("lists notes and redacts one (support), hiding it from the mobile read", async () => {
    const user = await makeUser();
    const checkin = await makeCheckIn(user.id, {
      note: "something offensive",
      localDate: "2026-07-10",
    });
    const app = buildApp();

    const list = await app.request("/api/v1/admin/moderation/checkin-notes", {
      headers: { authorization: bearerFor("read-only") },
    });
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { data: unknown };
    expect(adminCheckinNoteListResponseSchema.safeParse(listBody.data).success).toBe(true);

    const redact = await app.request(`/api/v1/admin/checkins/${checkin.id}/redact`, {
      method: "POST",
      headers: headers(bearerFor("support")),
    });
    expect(redact.status).toBe(200);

    const [row] = await db.select().from(checkIns).where(eq(checkIns.id, checkin.id));
    expect(row.hiddenAt).not.toBeNull();

    const audit = await db
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, "checkin_note.redact"));
    expect(audit).toHaveLength(1);

    // Restore clears it again.
    const restore = await app.request(`/api/v1/admin/checkins/${checkin.id}/restore`, {
      method: "POST",
      headers: headers(bearerFor("support")),
    });
    expect(restore.status).toBe(200);
    const [restored] = await db.select().from(checkIns).where(eq(checkIns.id, checkin.id));
    expect(restored.hiddenAt).toBeNull();
  });

  it("removing an avatar is admin-only and clears the profile image", async () => {
    const user = await makeUser({ image: "https://cdn.thrivo.fit/avatars/x.jpg" });
    const [upload] = await db
      .insert(uploads)
      .values({
        userId: user.id,
        entityType: "user",
        entityId: user.id,
        intent: "avatar",
        key: "avatars/x.jpg",
        publicUrl: "https://cdn.thrivo.fit/avatars/x.jpg",
        status: "verified",
        expiresAt: new Date(Date.now() + 3600_000),
      })
      .returning();

    const app = buildApp();

    const listRes = await app.request("/api/v1/admin/moderation/uploads", {
      headers: { authorization: bearerFor("read-only") },
    });
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { data: unknown };
    expect(adminUploadListResponseSchema.safeParse(listBody.data).success).toBe(true);

    const support = await app.request(`/api/v1/admin/uploads/${upload.id}/remove`, {
      method: "POST",
      headers: headers(bearerFor("support")),
    });
    expect(support.status).toBe(403);

    const admin = await app.request(`/api/v1/admin/uploads/${upload.id}/remove`, {
      method: "POST",
      headers: headers(bearerFor("admin")),
    });
    expect(admin.status).toBe(200);

    const [removed] = await db.select().from(uploads).where(eq(uploads.id, upload.id));
    expect(removed.deletedAt).not.toBeNull();
    const refreshed = await userRepo.findById(user.id);
    expect(refreshed?.image).toBeNull();
  });
});

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import { buildApp } from "../../src/app";
import { db } from "../../db";
import { env } from "../../src/env";
import { adminAuditLog, pushCampaigns, pushTokens } from "../../db/schema";
import { makeAdminUser, makeUser } from "../helpers/factories";
import { pushCampaignRepo, pushTokenRepo } from "../../src/repositories";
import {
  adminAudienceEstimateResponseSchema,
  adminPushCampaignDetailResponseSchema,
  adminPushCampaignListResponseSchema,
} from "../../contracts/src";

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

async function seedUserWithToken(tier: "free" | "premium", token: string) {
  const user = await makeUser({ tier });
  await pushTokenRepo.register({ userId: user.id, expoPushToken: token, platform: "ios" });
  return user;
}

describe.skipIf(!run)("integration: admin push campaigns", () => {
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

  it("estimates audience for a segment", async () => {
    await seedUserWithToken("premium", "ExponentPushToken[a]");
    await seedUserWithToken("free", "ExponentPushToken[b]");
    const app = buildApp();

    const res = await app.request("/api/v1/admin/push/audience-estimate", {
      method: "POST",
      headers: jsonHeaders(bearerFor("read-only")),
      body: JSON.stringify({ segment: { tier: "premium" } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown };
    const parsed = adminAudienceEstimateResponseSchema.safeParse(body.data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.userCount).toBe(1);
      expect(parsed.data.tokenCount).toBe(1);
    }
  });

  it("replaces a stale token when the same app installation registers again", async () => {
    const user = await makeUser();
    await pushTokenRepo.register({
      userId: user.id,
      expoPushToken: "ExponentPushToken[old-token]",
      platform: "ios",
      deviceId: "ios:installation-1",
    });
    await pushTokenRepo.register({
      userId: user.id,
      expoPushToken: "ExponentPushToken[new-token]",
      platform: "ios",
      deviceId: "ios:installation-1",
    });

    const rows = await db.select().from(pushTokens).where(eq(pushTokens.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      expoPushToken: "ExponentPushToken[new-token]",
      deviceId: "ios:installation-1",
      isActive: true,
    });
  });

  it("support creates a campaign (audited); read-only cannot", async () => {
    const app = buildApp();
    const payload = {
      title: "New feature",
      body: "Check out weekly insights!",
      segment: { all: true },
    };

    const ro = await app.request("/api/v1/admin/push/campaigns", {
      method: "POST",
      headers: jsonHeaders(bearerFor("read-only")),
      body: JSON.stringify(payload),
    });
    expect(ro.status).toBe(403);

    const res = await app.request("/api/v1/admin/push/campaigns", {
      method: "POST",
      headers: jsonHeaders(bearerFor("support")),
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: unknown };
    expect(adminPushCampaignDetailResponseSchema.safeParse(body.data).success).toBe(true);

    const audit = await db
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, "push_campaign.create"));
    expect(audit).toHaveLength(1);

    const list = await app.request("/api/v1/admin/push/campaigns", {
      headers: { authorization: bearerFor("read-only") },
    });
    const listBody = (await list.json()) as { data: unknown };
    expect(adminPushCampaignListResponseSchema.safeParse(listBody.data).success).toBe(true);
  });

  it("send is admin-only and flips the campaign to sending (audited)", async () => {
    const app = buildApp();
    const create = await app.request("/api/v1/admin/push/campaigns", {
      method: "POST",
      headers: jsonHeaders(bearerFor("support")),
      body: JSON.stringify({ title: "T", body: "B", segment: { all: true } }),
    });
    const created = (await create.json()) as { data: { campaign: { id: string } } };
    const id = created.data.campaign.id;

    const supportSend = await app.request(`/api/v1/admin/push/campaigns/${id}/send`, {
      method: "POST",
      headers: jsonHeaders(bearerFor("support")),
    });
    expect(supportSend.status).toBe(403);

    if (!env.ADMIN_PUSH_LIFECYCLE_ENABLED) {
      const disabled = await app.request(`/api/v1/admin/push/campaigns/${id}/send`, {
        method: "POST",
        headers: jsonHeaders(bearerFor("admin")),
      });
      expect(disabled.status).toBe(409);
      return;
    }

    const adminSend = await app.request(`/api/v1/admin/push/campaigns/${id}/send`, {
      method: "POST",
      headers: jsonHeaders(bearerFor("admin")),
    });
    expect(adminSend.status).toBe(202);

    const [row] = await db.select().from(pushCampaigns).where(eq(pushCampaigns.id, id));
    expect(row.status).toBe("sending");

    const sendAudit = await db
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, "push_campaign.send"));
    expect(sendAudit).toHaveLength(1);
  });

  it("rejects scheduled creation while the lifecycle flag is disabled", async () => {
    if (env.ADMIN_PUSH_LIFECYCLE_ENABLED) return;
    const app = buildApp();
    const res = await app.request("/api/v1/admin/push/campaigns", {
      method: "POST",
      headers: jsonHeaders(bearerFor("support")),
      body: JSON.stringify({
        title: "Scheduled",
        body: "Later",
        segment: { all: true },
        scheduledAt: "2099-01-01T00:00:00.000Z",
      }),
    });
    expect(res.status).toBe(409);
  });

  it("serializes a due-campaign claim against cancellation", async () => {
    const [campaign] = await db
      .insert(pushCampaigns)
      .values({
        title: "Race test",
        body: "Race test body",
        segment: { all: true },
        status: "scheduled",
        scheduledAt: new Date(Date.now() - 1_000),
        createdByAdminEmail: "admin@test.thrivo.fit",
      })
      .returning();

    const [claimed, canceled] = await Promise.all([
      pushCampaignRepo.claimDueScheduled(new Date()),
      pushCampaignRepo.cancelScheduled(campaign.id),
    ]);
    const [row] = await db.select().from(pushCampaigns).where(eq(pushCampaigns.id, campaign.id));

    expect(row).toBeDefined();
    expect(["sending", "canceled"]).toContain(row!.status);
    if (row!.status === "sending") {
      expect(claimed.map((item) => item.id)).toContain(campaign.id);
      expect(canceled).toBeNull();
    } else {
      expect(claimed.map((item) => item.id)).not.toContain(campaign.id);
      expect(canceled?.id).toBe(campaign.id);
    }
  });
});

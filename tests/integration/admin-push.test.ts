import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import { buildApp } from "../../src/app";
import { db } from "../../db";
import { env } from "../../src/env";
import { adminAuditLog, pushCampaigns } from "../../db/schema";
import { signAdminSession, ADMIN_COOKIE } from "../../src/admin/session.service";
import { pushTokenRepo } from "../../src/repositories";
import { makeUser } from "../helpers/factories";
import {
  adminAudienceEstimateResponseSchema,
  adminPushCampaignDetailResponseSchema,
  adminPushCampaignListResponseSchema,
} from "../../contracts/src";

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

async function seedUserWithToken(tier: "free" | "premium", token: string) {
  const user = await makeUser({ tier });
  await pushTokenRepo.register({ userId: user.id, expoPushToken: token, platform: "ios" });
  return user;
}

describe.skipIf(!run)("integration: admin push campaigns", () => {
  beforeEach(async () => {
    await resetDb();
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
      headers: jsonHeaders(await cookieFor("read-only")),
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

  it("support creates a campaign (audited); read-only cannot", async () => {
    const app = buildApp();
    const payload = {
      title: "New feature",
      body: "Check out weekly insights!",
      segment: { all: true },
    };

    const ro = await app.request("/api/v1/admin/push/campaigns", {
      method: "POST",
      headers: jsonHeaders(await cookieFor("read-only")),
      body: JSON.stringify(payload),
    });
    expect(ro.status).toBe(403);

    const res = await app.request("/api/v1/admin/push/campaigns", {
      method: "POST",
      headers: jsonHeaders(await cookieFor("support")),
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
      headers: { cookie: await cookieFor("read-only") },
    });
    const listBody = (await list.json()) as { data: unknown };
    expect(adminPushCampaignListResponseSchema.safeParse(listBody.data).success).toBe(true);
  });

  it("send is admin-only and flips the campaign to sending (audited)", async () => {
    const app = buildApp();
    const create = await app.request("/api/v1/admin/push/campaigns", {
      method: "POST",
      headers: jsonHeaders(await cookieFor("support")),
      body: JSON.stringify({ title: "T", body: "B", segment: { all: true } }),
    });
    const created = (await create.json()) as { data: { campaign: { id: string } } };
    const id = created.data.campaign.id;

    const supportSend = await app.request(`/api/v1/admin/push/campaigns/${id}/send`, {
      method: "POST",
      headers: jsonHeaders(await cookieFor("support")),
    });
    expect(supportSend.status).toBe(403);

    const adminSend = await app.request(`/api/v1/admin/push/campaigns/${id}/send`, {
      method: "POST",
      headers: jsonHeaders(await cookieFor("admin")),
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
});

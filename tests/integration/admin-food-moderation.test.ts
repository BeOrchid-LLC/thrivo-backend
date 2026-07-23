import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import { buildApp } from "../../src/app";
import { db } from "../../db";
import { env } from "../../src/env";
import { adminAuditLog, foodItems } from "../../db/schema";
import { makeAdminUser } from "../helpers/factories";
import { foodItemRepo } from "../../src/repositories";
import { adminFoodDetailResponseSchema, adminFoodListResponseSchema } from "../../contracts/src";

const run = process.env.RUN_DB_TESTS === "1";
const ALLOWED_ORIGIN = env.CORS_ORIGINS[0] ?? "http://localhost:3001";

function bearerFor(role: "admin" | "support" | "read-only") {
  return `Bearer test-clerk-token:test_${role.replace(/-/g, "")}:${role}@test.thrivo.fit`;
}

const jsonHeaders = (bearer: string) => ({
  authorization: bearer,
  Origin: ALLOWED_ORIGIN,
  "Content-Type": "application/json",
});

async function makeCommunityItem(name: string, status: "pending" | "active" = "pending") {
  return foodItemRepo.insertItem({ tier: "community", origin: "community", name, status });
}

describe.skipIf(!run)("integration: admin food moderation", () => {
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

  it("lists non-personal items and excludes personal ones", async () => {
    await makeCommunityItem("Community Oats");
    await foodItemRepo.insertItem({ tier: "personal", origin: "personal", name: "Private Snack" });

    const app = buildApp();
    const res = await app.request("/api/v1/admin/foods?limit=50", {
      headers: { authorization: bearerFor("read-only") },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown };
    const parsed = adminFoodListResponseSchema.safeParse(body.data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const names = parsed.data.items.map((i) => i.name);
      expect(names).toContain("Community Oats");
      expect(names).not.toContain("Private Snack");
    }
  });

  it("approves a pending item (support) and audits it", async () => {
    const item = await makeCommunityItem("Pending Bar");
    const app = buildApp();
    const res = await app.request(`/api/v1/admin/foods/${item.id}/approve`, {
      method: "POST",
      headers: jsonHeaders(bearerFor("support")),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown };
    expect(adminFoodDetailResponseSchema.safeParse(body.data).success).toBe(true);

    const [row] = await db.select().from(foodItems).where(eq(foodItems.id, item.id));
    expect(row.status).toBe("active");
    const audit = await db
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, "food.approve"));
    expect(audit).toHaveLength(1);
  });

  it("read-only cannot approve; merge requires admin", async () => {
    const item = await makeCommunityItem("Locked Item");
    const app = buildApp();

    const ro = await app.request(`/api/v1/admin/foods/${item.id}/approve`, {
      method: "POST",
      headers: jsonHeaders(bearerFor("read-only")),
    });
    expect(ro.status).toBe(403);

    const target = await makeCommunityItem("Canonical", "active");
    const supportMerge = await app.request(`/api/v1/admin/foods/${item.id}/merge`, {
      method: "POST",
      headers: jsonHeaders(bearerFor("support")),
      body: JSON.stringify({ mergeIntoId: target.id }),
    });
    expect(supportMerge.status).toBe(403);
  });

  it("merges a duplicate into a canonical item and marks it merged", async () => {
    const dupe = await makeCommunityItem("Dupe Milk");
    const canonical = await makeCommunityItem("Milk", "active");
    const app = buildApp();

    const res = await app.request(`/api/v1/admin/foods/${dupe.id}/merge`, {
      method: "POST",
      headers: jsonHeaders(bearerFor("admin")),
      body: JSON.stringify({ mergeIntoId: canonical.id, reason: "duplicate" }),
    });
    expect(res.status).toBe(200);

    const [row] = await db.select().from(foodItems).where(eq(foodItems.id, dupe.id));
    expect(row.status).toBe("merged");
    expect(row.mergedIntoId).toBe(canonical.id);
  });

  it("returns 404 for a personal item detail (privacy)", async () => {
    const personal = await foodItemRepo.insertItem({
      tier: "personal",
      origin: "personal",
      name: "Mine",
    });
    const app = buildApp();
    const res = await app.request(`/api/v1/admin/foods/${personal.id}`, {
      headers: { authorization: bearerFor("admin") },
    });
    expect(res.status).toBe(404);
  });
});

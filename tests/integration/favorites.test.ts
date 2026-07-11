import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import { authed, createSession } from "../helpers/auth";
import { makeTestApp } from "../helpers/app";
import { foodItemRepo } from "../../src/repositories";
import { userRepo } from "../../src/repositories";

// Integration suite — real test Postgres, gated by RUN_DB_TESTS=1.
const run = process.env.RUN_DB_TESTS === "1";

async function makeFavoritableItem(name: string) {
  const item = await foodItemRepo.insertItem({
    tier: "authoritative",
    origin: "openfoodfacts",
    name,
  });
  await foodItemRepo.upsertNutrients({
    foodItemId: item.id,
    basis: "per_serving",
    servingLabel: "1 serving",
    servingG: "100",
    kcal: "200",
    proteinG: "10",
    carbsG: "20",
    fatG: "5",
  });
  return item;
}

describe.skipIf(!run)("integration: favorites (R5-1 / I13)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeDb();
  });

  it("POST /favorites returns the single mutated item, not a re-list", async () => {
    const app = makeTestApp();
    const session = await createSession();
    const item = await makeFavoritableItem("Oatmeal");

    const res = await app.request("/api/v1/foods/favorites", {
      method: "POST",
      headers: { ...authed(session), "Content-Type": "application/json" },
      body: JSON.stringify({ foodItemId: item.id }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { item: { id: string; name: string } } };
    expect(body.data.item.id).toBe(item.id);
    expect(body.data.item.name).toBe("Oatmeal");
    expect(body.data).not.toHaveProperty("items");
  });

  it("DELETE /favorites/:id returns the removed item", async () => {
    const app = makeTestApp();
    const session = await createSession();
    const item = await makeFavoritableItem("Rice");

    await app.request("/api/v1/foods/favorites", {
      method: "POST",
      headers: { ...authed(session), "Content-Type": "application/json" },
      body: JSON.stringify({ foodItemId: item.id }),
    });

    const res = await app.request(`/api/v1/foods/favorites/${item.id}`, {
      method: "DELETE",
      headers: authed(session),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { item: { id: string } | null } };
    expect(body.data.item?.id).toBe(item.id);
  });

  it("GET /favorites preserves most-used-then-most-recent ordering across many favorites", async () => {
    const app = makeTestApp();
    const session = await createSession();
    const user = await userRepo.findActiveByEmail(session.email);
    expect(user).not.toBeNull();

    const items = await Promise.all(
      Array.from({ length: 5 }, (_, i) => makeFavoritableItem(`Food ${i}`))
    );
    for (const item of items) {
      await app.request("/api/v1/foods/favorites", {
        method: "POST",
        headers: { ...authed(session), "Content-Type": "application/json" },
        body: JSON.stringify({ foodItemId: item.id }),
      });
    }

    const res = await app.request("/api/v1/foods/favorites", { headers: authed(session) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { items: Array<{ id: string; name: string }> } };
    expect(body.data.items).toHaveLength(5);
    // Most recently added favorite sorts first (equal useCount, lastUsedAt desc).
    expect(body.data.items[0]!.id).toBe(items[4]!.id);
    expect(body.data.items[4]!.id).toBe(items[0]!.id);
  });
});

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import { authed, createSession } from "../helpers/auth";
import { makeTestApp } from "../helpers/app";
import { foodItemRepo, userRepo } from "../../src/repositories";

const run = process.env.RUN_DB_TESTS === "1";

const { searchOpenFoodFactsProducts } = vi.hoisted(() => ({
  searchOpenFoodFactsProducts: vi.fn(),
}));

vi.mock("../../src/integrations/open-food-facts", async () => {
  const actual = await vi.importActual<typeof import("../../src/integrations/open-food-facts")>(
    "../../src/integrations/open-food-facts"
  );
  return {
    ...actual,
    searchOpenFoodFactsProducts,
  };
});

async function seedCatalogItem(input: { name: string; barcode?: string; ownerUserId?: string }) {
  const item = await foodItemRepo.insertItem({
    tier: input.ownerUserId ? "personal" : "authoritative",
    origin: input.ownerUserId ? "personal" : "openfoodfacts",
    name: input.name,
    barcode: input.barcode ?? null,
    originRef: input.barcode ?? null,
    ownerUserId: input.ownerUserId ?? null,
    createdBy: input.ownerUserId ?? null,
  });
  await foodItemRepo.upsertNutrients({
    foodItemId: item.id,
    basis: "per_100g",
    servingLabel: "100g",
    servingG: null,
    kcal: "165",
    proteinG: "31",
    carbsG: "0",
    fatG: "4",
  });
  return item;
}

describe.skipIf(!run)("integration: catalog-first food search", () => {
  beforeEach(async () => {
    await resetDb();
    searchOpenFoodFactsProducts.mockReset();
    searchOpenFoodFactsProducts.mockResolvedValue([]);
  });
  afterAll(async () => {
    await closeDb();
  });

  it("serves personal + public local hits before calling OFF", async () => {
    const app = makeTestApp();
    const session = await createSession();
    const other = await createSession();
    const user = await userRepo.findActiveByEmail(session.email);
    const otherUser = await userRepo.findActiveByEmail(other.email);
    expect(user).toBeTruthy();
    expect(otherUser).toBeTruthy();

    const personal = await seedCatalogItem({
      name: "Chicken suya",
      ownerUserId: user!.id,
    });
    const publicItem = await seedCatalogItem({
      name: "Chicken breast grilled",
      barcode: "1000000000001",
    });
    await seedCatalogItem({
      name: "Chicken thigh other user",
      ownerUserId: otherUser!.id,
    });

    const res = await app.request("/api/v1/foods/search?q=chicken&limit=10", {
      headers: authed(session),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        items: Array<{ id: string; name: string; isPersonal: boolean }>;
        phase: string;
        nextCursor: string | null;
      };
    };

    expect(body.data.phase).toBe("local");
    expect(body.data.items.map((item) => item.id)).toEqual([personal.id, publicItem.id]);
    expect(body.data.items[0]?.isPersonal).toBe(true);
    expect(body.data.nextCursor).toBe("external:1");
    expect(searchOpenFoodFactsProducts).not.toHaveBeenCalled();
  });

  it("switches to external phase and materializes OFF hits with real ids", async () => {
    const app = makeTestApp();
    const session = await createSession();
    searchOpenFoodFactsProducts.mockResolvedValueOnce([
      {
        externalId: "off:2000000000002",
        name: "Chicken noodle soup",
        brand: null,
        barcode: "2000000000002",
        basis: "per_100g",
        servingLabel: "250ml",
        servingGrams: 250,
        nutrients: { calories: 62, proteinG: 3, carbsG: 8, fatG: 1 },
        source: "openfoodfacts",
      },
    ]);

    const first = await app.request("/api/v1/foods/search?q=zzzznohit&limit=10", {
      headers: authed(session),
    });
    const firstBody = (await first.json()) as {
      data: { items: unknown[]; nextCursor: string | null; phase: string };
    };
    expect(firstBody.data.phase).toBe("local");
    expect(firstBody.data.items).toEqual([]);
    expect(firstBody.data.nextCursor).toBe("external:1");

    const second = await app.request(
      `/api/v1/foods/search?q=zzzznohit&limit=10&cursor=${encodeURIComponent("external:1")}`,
      { headers: authed(session) }
    );
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as {
      data: {
        items: Array<{ id: string; name: string; barcode: string | null }>;
        phase: string;
        nextCursor: string | null;
      };
    };
    expect(secondBody.data.phase).toBe("external");
    expect(secondBody.data.items).toHaveLength(1);
    expect(secondBody.data.items[0]?.name).toBe("Chicken noodle soup");
    expect(secondBody.data.items[0]?.barcode).toBe("2000000000002");
    expect(secondBody.data.items[0]?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(secondBody.data.nextCursor).toBeNull();
    expect(searchOpenFoodFactsProducts).toHaveBeenCalledWith("zzzznohit", 10, 1);

    const cached = await foodItemRepo.findActiveByBarcode("2000000000002");
    expect(cached?.id).toBe(secondBody.data.items[0]?.id);
  });
});

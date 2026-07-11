import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";
import { buildApp } from "../../src/app";
import { signAdminSession, ADMIN_COOKIE } from "../../src/admin/session.service";

// Integration suite — real test Postgres, gated by RUN_DB_TESTS=1.
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

type ListResponse = {
  data: { items: Array<{ id: string }>; pagination: { nextCursor: string | null; total: number } };
};

describe.skipIf(!run)("integration: admin keyset pagination (R5-4 / I16)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeDb();
  });

  it("pages through every user exactly once via nextCursor, with no OFFSET drift under a concurrent insert", async () => {
    const app = buildApp();
    const cookie = await adminCookie();
    for (let i = 0; i < 9; i++) await makeUser();

    const seen: string[] = [];
    let cursor: string | undefined;
    let page = 0;

    for (;;) {
      const qs = new URLSearchParams({ limit: "4", ...(cursor ? { cursor } : {}) });
      const res = await app.request(`/api/v1/admin/users?${qs.toString()}`, {
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as ListResponse;
      seen.push(...body.data.items.map((item) => item.id));
      page += 1;

      // Simulate a new signup landing between page reads — an OFFSET-based
      // scheme would shift every subsequent page by one and either skip or
      // duplicate a row; a keyset cursor must be immune to it.
      if (page === 1) await makeUser();

      cursor = body.data.pagination.nextCursor ?? undefined;
      if (!cursor) break;
      if (page > 20) throw new Error("pagination did not terminate");
    }

    // 9 seeded + 1 inserted mid-walk = 10 users, each seen exactly once.
    expect(seen).toHaveLength(10);
    expect(new Set(seen).size).toBe(10);
  });

  it("email-capture leads list pages via cursor the same way", async () => {
    const app = buildApp();
    const cookie = await adminCookie();

    for (let i = 0; i < 5; i++) {
      await app.request("/api/v1/leads/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: `lead${i}@test.thrivo.fit`, source: "cta" }),
      });
    }

    const first = await app.request("/api/v1/admin/leads?limit=2", {
      headers: { Cookie: cookie },
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as ListResponse;
    expect(firstBody.data.items).toHaveLength(2);
    expect(firstBody.data.pagination.total).toBeGreaterThanOrEqual(5);
    expect(firstBody.data.pagination.nextCursor).not.toBeNull();

    const second = await app.request(
      `/api/v1/admin/leads?limit=2&cursor=${encodeURIComponent(firstBody.data.pagination.nextCursor!)}`,
      { headers: { Cookie: cookie } }
    );
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as ListResponse;
    const firstIds = new Set(firstBody.data.items.map((i) => i.id));
    for (const item of secondBody.data.items) expect(firstIds.has(item.id)).toBe(false);
  });
});

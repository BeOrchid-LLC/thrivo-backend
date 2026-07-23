import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import { makeAdminUser, makeUser } from "../helpers/factories";
import { buildApp } from "../../src/app";

// Integration suite — real test Postgres, gated by RUN_DB_TESTS=1.
const run = process.env.RUN_DB_TESTS === "1";

function adminBearer() {
  return "Bearer test-clerk-token:test_admin:admin@test.thrivo.fit";
}

type ListResponse = {
  data: { items: Array<{ id: string }>; pagination: { nextCursor: string | null; total: number } };
};

describe.skipIf(!run)("integration: admin keyset pagination (R5-4 / I16)", () => {
  beforeEach(async () => {
    await resetDb();
    await makeAdminUser("admin@test.thrivo.fit", "admin");
  });
  afterAll(async () => {
    await closeDb();
  });

  it("pages through every pre-existing user exactly once via nextCursor, with no OFFSET drift under a concurrent insert", async () => {
    const app = buildApp();
    const bearer = adminBearer();
    const seeded = await Promise.all(Array.from({ length: 9 }, () => makeUser()));
    const expectedIds = seeded.map((user) => user.id).sort();

    const seen: string[] = [];
    let cursor: string | undefined;
    let page = 0;

    for (;;) {
      const qs = new URLSearchParams({ limit: "4", ...(cursor ? { cursor } : {}) });
      const res = await app.request(`/api/v1/admin/users?${qs.toString()}`, {
        headers: { authorization: bearer },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as ListResponse;
      seen.push(...body.data.items.map((item) => item.id));
      page += 1;

      // Simulate a new signup landing between page reads. It's newer than
      // every already-seeded user, so — correctly — it lands *ahead* of the
      // cursor and never appears in the rest of this descending walk (the
      // same way a new email at the top of your inbox doesn't appear while
      // you're scrolling into older ones). What must NOT happen is an
      // OFFSET-style shift causing one of the 9 pre-existing rows to be
      // skipped or duplicated because of the insert.
      if (page === 1) await makeUser();

      cursor = body.data.pagination.nextCursor ?? undefined;
      if (!cursor) break;
      if (page > 20) throw new Error("pagination did not terminate");
    }

    expect(seen.slice().sort()).toEqual(expectedIds);
  });

  it("email-capture leads list pages via cursor the same way", async () => {
    const app = buildApp();
    const bearer = adminBearer();

    for (let i = 0; i < 5; i++) {
      await app.request("/api/v1/leads/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: `lead${i}@test.thrivo.fit`, source: "cta" }),
      });
    }

    const first = await app.request("/api/v1/admin/leads?limit=2", {
      headers: { authorization: bearer },
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as ListResponse;
    expect(firstBody.data.items).toHaveLength(2);
    expect(firstBody.data.pagination.total).toBeGreaterThanOrEqual(5);
    expect(firstBody.data.pagination.nextCursor).not.toBeNull();

    const second = await app.request(
      `/api/v1/admin/leads?limit=2&cursor=${encodeURIComponent(firstBody.data.pagination.nextCursor!)}`,
      { headers: { authorization: bearer } }
    );
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as ListResponse;
    const firstIds = new Set(firstBody.data.items.map((i) => i.id));
    for (const item of secondBody.data.items) expect(firstIds.has(item.id)).toBe(false);
  });
});

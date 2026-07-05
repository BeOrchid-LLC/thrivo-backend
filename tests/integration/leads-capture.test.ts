import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, resetDb } from "../helpers/db";
import { buildApp } from "../../src/app";
import { db } from "../../db";
import { emailCaptures } from "../../db/schema";

// Leads-capture flow against a real Postgres + Redis. Gated; enable with RUN_DB_TESTS=1.
const run = process.env.RUN_DB_TESTS === "1";

type JsonBody = { success: boolean; data: { captured: true } | null; message: string };

function post(
  app: ReturnType<typeof buildApp>,
  body: unknown,
  headers: Record<string, string> = {}
) {
  return app.request("/api/v1/leads/capture", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!run)("integration: leads capture", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeDb();
  });

  it("first submission creates a row with submissionCount=1", async () => {
    const res = await post(
      buildApp(),
      { email: "New@Test.thrivo.fit", source: "cta" },
      {
        "cf-ipcountry": "NG",
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)",
      }
    );
    expect(res.status).toBe(200);

    const [row] = await db
      .select()
      .from(emailCaptures)
      .where(eq(emailCaptures.email, "new@test.thrivo.fit"));
    expect(row?.submissionCount).toBe(1);
    expect(row?.country).toBe("NG");
    expect(row?.deviceType).toBe("mobile");
  });

  it("resubmission returns an identical response and upserts in place", async () => {
    const app = buildApp();
    const email = "repeat@test.thrivo.fit";

    const first = await post(app, { email, source: "cta" }, { "cf-ipcountry": "NG" });
    const firstBody = (await first.json()) as JsonBody;
    const [firstRow] = await db.select().from(emailCaptures).where(eq(emailCaptures.email, email));

    const second = await post(app, { email, source: "cta" }, { "cf-ipcountry": "US" });
    const secondBody = (await second.json()) as JsonBody;
    const [secondRow] = await db.select().from(emailCaptures).where(eq(emailCaptures.email, email));

    // Identical shape/message/status on both — never reveals "already registered".
    expect(second.status).toBe(first.status);
    expect(secondBody).toEqual(firstBody);

    // But the row itself tracked the resubmission and refreshed metadata.
    expect(secondRow?.id).toBe(firstRow?.id);
    expect(secondRow?.capturedAt).toEqual(firstRow?.capturedAt);
    expect(secondRow?.submissionCount).toBe(2);
    expect(secondRow?.country).toBe("US");
  });

  it("missing cf-ipcountry stores a null country", async () => {
    await post(buildApp(), { email: "nocountry@test.thrivo.fit", source: "cta" });
    const [row] = await db
      .select()
      .from(emailCaptures)
      .where(eq(emailCaptures.email, "nocountry@test.thrivo.fit"));
    expect(row?.country).toBeNull();
  });

  it("rejects an invalid email", async () => {
    const res = await post(buildApp(), { email: "not-an-email", source: "cta" });
    expect(res.status).toBe(422);
  });

  it("rate-limits after 5 requests per IP in the window", async () => {
    const app = buildApp();
    for (let i = 0; i < 5; i++) {
      const res = await post(app, { email: `rl${i}@test.thrivo.fit`, source: "cta" });
      expect(res.status).toBe(200);
    }
    const sixth = await post(app, { email: "rl-over@test.thrivo.fit", source: "cta" });
    expect(sixth.status).toBe(429);
  });
});

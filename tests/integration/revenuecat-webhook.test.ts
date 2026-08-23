import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Inject the webhook shared secret without touching any other env value (DB,
// auth, etc. are preserved) so the signature gate can be exercised end-to-end.
vi.mock("../../src/env", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/env")>();
  return { ...mod, env: { ...mod.env, REVENUECAT_WEBHOOK_AUTH: "test-webhook-secret" } };
});

import { and, eq } from "drizzle-orm";
import { buildApp } from "../../src/app";
import { db } from "../../db";
import { emailLogs } from "../../db/schema";
import { subscriptionRepo, userRepo } from "../../src/repositories";
import { createSession } from "../helpers/auth";
import { closeDb, resetDb } from "../helpers/db";

const run = process.env.RUN_DB_TESTS === "1";
const SECRET = "test-webhook-secret";

type App = ReturnType<typeof buildApp>;
type OutcomeBody = { data: { outcome: string } };

function rcEvent(over: Record<string, unknown> = {}) {
  const now = Date.now();
  const appUserId =
    typeof over.app_user_id === "string"
      ? over.app_user_id
      : "00000000-0000-0000-0000-000000000000";
  return {
    event: {
      id: `evt_${Math.random().toString(36).slice(2)}`,
      type: "INITIAL_PURCHASE",
      app_user_id: appUserId,
      original_app_user_id: appUserId,
      product_id: "thrivo_premium_monthly",
      period_type: "NORMAL",
      store: "APP_STORE",
      purchased_at_ms: now,
      expiration_at_ms: now + 30 * 24 * 3600 * 1000,
      event_timestamp_ms: now,
      ...over,
    },
  };
}

function post(app: App, body: unknown, auth: string | null = SECRET) {
  return app.request("/api/v1/webhooks/revenuecat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(auth ? { authorization: auth } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!run)("integration: revenuecat webhook", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeDb();
  });

  it("rejects a bad signature with 403 and applies nothing", async () => {
    const app = buildApp();
    const session = await createSession();
    const user = await userRepo.findActiveByEmail(session.email);

    const res = await post(app, rcEvent({ app_user_id: user!.id }), "wrong-secret");

    expect(res.status).toBe(403);
    expect(await subscriptionRepo.getByUser(user!.id)).toBeNull();
  });

  it("applies entitlement from INITIAL_PURCHASE and is idempotent on replay", async () => {
    const app = buildApp();
    const session = await createSession();
    const user = await userRepo.findActiveByEmail(session.email);
    const event = rcEvent({ app_user_id: user!.id });

    const res1 = await post(app, event);
    expect(res1.status).toBe(200);
    expect(((await res1.json()) as OutcomeBody).data.outcome).toBe("processed");

    const after = await userRepo.findById(user!.id);
    expect(after!.tier).toBe("premium");
    const sub = await subscriptionRepo.getByUser(user!.id);
    expect(sub!.status).toBe("active");

    // Same event id again → ledger dedupes, no double-apply.
    const res2 = await post(app, event);
    expect(res2.status).toBe(200);
    expect(((await res2.json()) as OutcomeBody).data.outcome).toBe("duplicate");
  });

  it("sends a cancellation confirmation email only for CANCELLATION, not EXPIRATION (A5-5)", async () => {
    const app = buildApp();
    const session = await createSession();
    const user = await userRepo.findActiveByEmail(session.email);

    // Establish an active subscription first so CANCELLATION has something to cancel.
    await post(app, rcEvent({ app_user_id: user!.id, type: "INITIAL_PURCHASE" }));

    const cancelRes = await post(
      app,
      rcEvent({
        app_user_id: user!.id,
        type: "CANCELLATION",
        event_timestamp_ms: Date.now() + 1000,
      })
    );
    expect(cancelRes.status).toBe(200);

    const cancelLogs = await db
      .select()
      .from(emailLogs)
      .where(and(eq(emailLogs.toEmail, user!.email!), eq(emailLogs.template, "notification")));
    expect(cancelLogs).toHaveLength(1);

    // EXPIRATION must not trigger a second cancellation-style email.
    const expireRes = await post(
      app,
      rcEvent({ app_user_id: user!.id, type: "EXPIRATION", event_timestamp_ms: Date.now() + 2000 })
    );
    expect(expireRes.status).toBe(200);

    const afterExpiration = await db
      .select()
      .from(emailLogs)
      .where(and(eq(emailLogs.toEmail, user!.email!), eq(emailLogs.template, "notification")));
    expect(afterExpiration).toHaveLength(1);
  });

  it("drops a stale out-of-order event so newer entitlement is never reverted", async () => {
    const app = buildApp();
    const session = await createSession();
    const user = await userRepo.findActiveByEmail(session.email);
    const now = Date.now();

    await post(app, rcEvent({ app_user_id: user!.id, type: "RENEWAL", event_timestamp_ms: now }));

    const res = await post(
      app,
      rcEvent({ app_user_id: user!.id, type: "EXPIRATION", event_timestamp_ms: now - 10_000 })
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as OutcomeBody).data.outcome).toBe("ignored");

    const after = await userRepo.findById(user!.id);
    expect(after!.tier).toBe("premium"); // not reverted to free
  });

  it("never lets a stale EXPIRATION win a true race against a fresh RENEWAL (I5)", async () => {
    const app = buildApp();
    const session = await createSession();
    const user = await userRepo.findActiveByEmail(session.email);
    const now = Date.now();

    // Baseline row so both concurrent events hit the ON CONFLICT DO UPDATE path,
    // not the initial insert.
    await post(
      app,
      rcEvent({ app_user_id: user!.id, type: "INITIAL_PURCHASE", event_timestamp_ms: now - 60_000 })
    );

    const [renewal, staleExpiration] = await Promise.all([
      post(app, rcEvent({ app_user_id: user!.id, type: "RENEWAL", event_timestamp_ms: now })),
      post(
        app,
        rcEvent({ app_user_id: user!.id, type: "EXPIRATION", event_timestamp_ms: now - 10_000 })
      ),
    ]);
    expect(renewal.status).toBe(200);
    expect(staleExpiration.status).toBe(200);

    const after = await userRepo.findById(user!.id);
    expect(after!.tier).toBe("premium");
    const sub = await subscriptionRepo.getByUser(user!.id);
    expect(sub!.status).toBe("active");
  });
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { authed, createSession } from "../helpers/auth";
import { closeDb, resetDb } from "../helpers/db";
import { makeTestApp } from "../helpers/app";
import { makeFoodLog, makeWaterEntry, makeWeightEntry } from "../helpers/factories";
import { dailySummaryRepo, userRepo } from "../../src/repositories";

const run = process.env.RUN_DB_TESTS === "1";

describe.skipIf(!run)("integration: progress metrics", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("allows free users to log water and fetch 14-day charts", async () => {
    const app = makeTestApp();
    const session = await createSession();

    const addWater = await app.request("/api/v1/metrics/water", {
      method: "POST",
      headers: { ...authed(session), "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-06-28", amountMl: 250 }),
    });
    expect(addWater.status).toBe(200);

    const chart = await app.request(
      "/api/v1/metrics/chart?date=2026-06-28&metric=water&period=14d",
      { headers: authed(session) }
    );
    expect(chart.status).toBe(200);
    const body = await chart.json();
    expect(body.data.chart.points).toHaveLength(14);
  });

  it("requires premium for activity history beyond 14 days", async () => {
    const app = makeTestApp();
    const session = await createSession();

    const chart = await app.request(
      "/api/v1/metrics/chart?date=2026-06-28&metric=weight&period=1m",
      { headers: authed(session) }
    );
    expect(chart.status).toBe(403);
    const body = await chart.json();
    expect(body.error.code).toBe("PREMIUM_REQUIRED");
  });

  it("returns macro chart points from daily summaries", async () => {
    const app = makeTestApp();
    const session = await createSession();
    const user = await userRepo.findActiveByEmail(session.email);
    expect(user).not.toBeNull();
    await dailySummaryRepo.upsertForDay({
      userId: user!.id,
      localDate: "2026-06-27",
      totalCalories: 1600,
      totalProteinG: "120",
      totalCarbsG: "150",
      totalFatG: "55",
    });

    const chart = await app.request(
      "/api/v1/metrics/chart?date=2026-06-28&metric=protein&period=7d",
      { headers: authed(session) }
    );
    expect(chart.status).toBe(200);
    const body = await chart.json();
    expect(body.data.chart.unit).toBe("g");
    expect(body.data.chart.points).toContainEqual({ date: "2026-06-27", value: 120 });
  });

  it("saves weight entries for free users and upserts a local day", async () => {
    const app = makeTestApp();
    const session = await createSession();

    const first = await app.request("/api/v1/metrics/weight", {
      method: "POST",
      headers: { ...authed(session), "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-06-28", weightKg: 80.7 }),
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json();

    const second = await app.request("/api/v1/metrics/weight", {
      method: "POST",
      headers: { ...authed(session), "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-06-28", weightKg: 80.2 }),
    });
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.data.entry.id).toBe(firstBody.data.entry.id);
    expect(secondBody.data.entry.weightKg).toBe(80.2);
  });

  it("keeps weight delete scoped to the owning user", async () => {
    const app = makeTestApp();
    const owner = await createSession();
    const other = await createSession();
    const ownerUser = await userRepo.findActiveByEmail(owner.email);
    expect(ownerUser).not.toBeNull();
    const entry = await makeWeightEntry(ownerUser!.id, {
      localDate: "2026-06-28",
      weightKg: "80.7",
    });

    const response = await app.request(`/api/v1/metrics/weight/${entry.id}`, {
      method: "DELETE",
      headers: authed(other),
    });
    expect(response.status).toBe(404);
  });

  it("returns progress summary for free users", async () => {
    const app = makeTestApp();
    const session = await createSession();
    const user = await userRepo.findActiveByEmail(session.email);
    expect(user).not.toBeNull();
    await makeWaterEntry(user!.id, { localDate: "2026-06-28", amountMl: 500 });
    await makeWeightEntry(user!.id, { localDate: "2026-06-28", weightKg: "80.7" });

    const response = await app.request("/api/v1/metrics/progress?date=2026-06-28", {
      headers: authed(session),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.progress.summary.currentWeightKg).toBe(80.7);
  });

  it("marks a day logged exactly once even with multiple food logs that day (R5-2 / I14)", async () => {
    const app = makeTestApp();
    const session = await createSession();
    const user = await userRepo.findActiveByEmail(session.email);
    expect(user).not.toBeNull();

    // Three logs on the same day must still surface as one "logged" calendar cell —
    // the old full-row load and the new SELECT DISTINCT must agree on this.
    await makeFoodLog(user!.id, { localDate: "2026-06-05" });
    await makeFoodLog(user!.id, { localDate: "2026-06-05" });
    await makeFoodLog(user!.id, { localDate: "2026-06-05" });
    await makeFoodLog(user!.id, { localDate: "2026-06-12" });

    const response = await app.request("/api/v1/metrics/progress?date=2026-06-15", {
      headers: authed(session),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    const days = body.data.progress.calendar.days as Array<{ day: string; logged: boolean }>;
    const logged = days.filter((d) => d.logged).map((d) => d.day);
    expect(logged.sort()).toEqual(["2026-06-05", "2026-06-12"]);
  });
});

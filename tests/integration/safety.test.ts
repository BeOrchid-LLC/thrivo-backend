import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import {
  makeUser,
  makeFoodItem,
  makeWeightEntry,
  makeWaterEntry,
  makeCheckIn,
  makeFoodLog,
} from "../helpers/factories";
import {
  weightEntryRepo,
  waterIntakeRepo,
  foodFavoriteRepo,
  checkInRepo,
  webhookEventRepo,
  dailySummaryRepo,
  subscriptionRepo,
  emailLogRepo,
} from "../../src/repositories";
import {
  getDashboardCalories,
  getDashboardMacros,
  getHistoryDays,
  getMealGroupsForDay,
  getWaterState,
} from "../../src/services/dashboard.service";

// Highest-risk invariants that exist today: per-user data isolation (IDOR),
// webhook idempotency, upsert idempotency, and the email-log lifecycle. Auth /
// route-level coverage lands with A1-4/A1-6 on top of this same harness.
const run = process.env.RUN_DB_TESTS === "1";

describe.skipIf(!run)("integration: safety invariants", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeDb();
  });

  describe("IDOR — a user only ever sees/affects their own rows", () => {
    it("weight entries are scoped per user (read + delete)", async () => {
      const a = await makeUser();
      const b = await makeUser();
      const entry = await makeWeightEntry(a.id, { weightKg: "82.5" });

      const past = new Date(Date.now() - 86_400_000);
      const future = new Date(Date.now() + 86_400_000);
      expect(await weightEntryRepo.listForUser(b.id, past, future)).toHaveLength(0);

      // B cannot delete A's entry (userId is part of the predicate).
      await weightEntryRepo.deleteEntry(entry.id, b.id);
      expect(await weightEntryRepo.listForUser(a.id, past, future)).toHaveLength(1);
    });

    it("water totals are scoped per user", async () => {
      const a = await makeUser();
      const b = await makeUser();
      await makeWaterEntry(a.id, { amountMl: 500, localDate: "2026-06-10" });

      expect(await waterIntakeRepo.getDayTotal(a.id, "2026-06-10")).toBe(500);
      expect(await waterIntakeRepo.getDayTotal(b.id, "2026-06-10")).toBe(0);
    });

    it("favorites are scoped per user", async () => {
      const a = await makeUser();
      const b = await makeUser();
      const item = await makeFoodItem({ ownerUserId: a.id });
      await foodFavoriteRepo.addFavorite({ userId: a.id, foodItemId: item.id });

      expect(await foodFavoriteRepo.listForUser(a.id)).toHaveLength(1);
      expect(await foodFavoriteRepo.listForUser(b.id)).toHaveLength(0);
    });

    it("check-ins are scoped per user", async () => {
      const a = await makeUser();
      const b = await makeUser();
      await makeCheckIn(a.id, { localDate: "2026-06-10" });

      expect(await checkInRepo.getForDay(a.id, "2026-06-10")).not.toBeNull();
      expect(await checkInRepo.getForDay(b.id, "2026-06-10")).toBeNull();
    });
  });

  describe("idempotency", () => {
    it("webhook replays are no-ops (unique provider+event_id)", async () => {
      const event = {
        provider: "revenuecat" as const,
        eventId: "evt_123",
        payload: { type: "INITIAL_PURCHASE" },
      };
      const first = await webhookEventRepo.recordReceived(event);
      const replay = await webhookEventRepo.recordReceived(event);

      expect(first).not.toBeNull();
      expect(replay).toBeNull(); // onConflictDoNothing → replay inserts nothing
      expect(await webhookEventRepo.existsByProviderEvent("revenuecat", "evt_123")).toBe(true);
    });

    it("daily-summary upsert overwrites the same user-day, not duplicates it", async () => {
      const user = await makeUser();
      await dailySummaryRepo.upsertForDay({
        userId: user.id,
        localDate: "2026-06-10",
        totalCalories: 1200,
      });
      const updated = await dailySummaryRepo.upsertForDay({
        userId: user.id,
        localDate: "2026-06-10",
        totalCalories: 1800,
      });

      expect(updated.totalCalories).toBe(1800);
      const day = await dailySummaryRepo.getForDay(user.id, "2026-06-10");
      expect(day?.totalCalories).toBe(1800);
    });

    it("subscription upsert keeps one row per user (webhook projection)", async () => {
      const user = await makeUser();
      await subscriptionRepo.upsertFromWebhook({
        userId: user.id,
        provider: "app_store",
        status: "trialing",
      });
      const active = await subscriptionRepo.upsertFromWebhook({
        userId: user.id,
        provider: "app_store",
        status: "active",
      });

      expect(active.status).toBe("active");
      expect((await subscriptionRepo.getByUser(user.id))?.status).toBe("active");
    });
  });

  describe("email log lifecycle", () => {
    it("records a queued send then transitions it to sent", async () => {
      const user = await makeUser();
      const log = await emailLogRepo.logSend({
        userId: user.id,
        toEmail: user.email,
        template: "notification",
        status: "queued",
      });
      expect(log.status).toBe("queued");

      await emailLogRepo.updateStatus(log.id, "sent", { providerMessageId: "msg_1" });
      const [after] = await emailLogRepo.listForUser(user.id);
      expect(after.status).toBe("sent");
      expect(after.providerMessageId).toBe("msg_1");
    });
  });

  describe("home dashboard section services", () => {
    it("returns empty dashboard section states for a new user", async () => {
      const user = await makeUser({
        dailyTargetKcal: 1800,
        targetProteinG: 120,
        targetCarbsG: 200,
        targetFatG: 60,
      });

      await expect(getDashboardCalories(user, "2026-06-10")).resolves.toMatchObject({
        consumedCalories: 0,
        targetCalories: 1800,
        remainingCalories: 1800,
      });
      await expect(getDashboardMacros(user, "2026-06-10")).resolves.toMatchObject({
        consumed: { proteinG: 0, carbsG: 0, fatG: 0 },
        target: { proteinG: 120, carbsG: 200, fatG: 60 },
      });
      await expect(getWaterState(user, "2026-06-10")).resolves.toMatchObject({
        totalMl: 0,
        targetGlasses: 8,
      });
      await expect(getMealGroupsForDay(user, "2026-06-10")).resolves.toEqual([]);
    });

    it("aggregates populated day calories, macros, water and meal groups", async () => {
      const user = await makeUser({ dailyTargetKcal: 1800 });
      await makeFoodLog(user.id, {
        localDate: "2026-06-10",
        meal: "breakfast",
        name: "Greek yogurt",
        kcal: 130,
        proteinG: "12",
        carbsG: "14",
        fatG: "4",
      });
      await makeWaterEntry(user.id, { localDate: "2026-06-10", amountMl: 500 });

      const calories = await getDashboardCalories(user, "2026-06-10");
      const macros = await getDashboardMacros(user, "2026-06-10");
      const water = await getWaterState(user, "2026-06-10");
      const groups = await getMealGroupsForDay(user, "2026-06-10");

      expect(calories.consumedCalories).toBe(130);
      expect(macros.consumed.proteinG).toBe(12);
      expect(water.glasses).toBe(2);
      expect(groups[0]?.entries[0]?.name).toBe("Greek yogurt");
    });

    it("redacts free history older than seven days but leaves premium history visible", async () => {
      const freeUser = await makeUser({ tier: "free" });
      const premiumUser = await makeUser({ tier: "premium" });
      await makeFoodLog(freeUser.id, { localDate: "2026-05-01", name: "Private old meal" });
      await makeFoodLog(premiumUser.id, { localDate: "2026-05-01", name: "Visible old meal" });

      const freeHistory = await getHistoryDays(freeUser, {
        from: "2026-05-01",
        to: new Date().toISOString().slice(0, 10),
      });
      const premiumHistory = await getHistoryDays(premiumUser, {
        from: "2026-05-01",
        to: new Date().toISOString().slice(0, 10),
      });

      expect(freeHistory.days[0]).toMatchObject({ day: "2026-05-01", isLocked: true, groups: [] });
      expect(JSON.stringify(freeHistory)).not.toContain("Private old meal");
      expect(premiumHistory.days[0]?.groups[0]?.entries[0]?.name).toBe("Visible old meal");
    });
  });
});

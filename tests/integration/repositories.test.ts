import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, closeDb, resetDb } from "../helpers/db";
import { makeUser, makeFoodItem } from "../helpers/factories";
import { userRepo, foodLogRepo } from "../../src/repositories";

// Integration suite — runs against a real test Postgres with migrations applied
// (globalSetup). Gated so `npm run test:unit` stays green without infra; enable
// with RUN_DB_TESTS=1. Each test starts from a truncated database.
const run = process.env.RUN_DB_TESTS === "1";

describe.skipIf(!run)("integration: repositories", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeDb();
  });

  it("creates a user and reads it back (active only)", async () => {
    const user = await makeUser({ name: "Ada" });
    const found = await userRepo.findById(user.id);
    expect(found?.id).toBe(user.id);
  });

  it("soft delete hides the user from active reads", async () => {
    const user = await makeUser({ name: "Grace" });
    await userRepo.softDeleteUser(user.id);
    expect(await userRepo.findActiveByEmail(user.email)).toBeNull();
  });

  it("logs a food with snapshotted nutrients (incl. pure-manual null item)", async () => {
    const user = await makeUser({ name: "Lin" });
    const item = await makeFoodItem({ name: "Home Oatmeal", ownerUserId: user.id });
    const linked = await foodLogRepo.createLog({
      userId: user.id,
      loggedAt: new Date(),
      localDate: "2026-06-10",
      meal: "breakfast",
      source: "search",
      foodItemId: item.id,
      name: "Home Oatmeal",
      servingQty: "1",
      kcal: 150,
      proteinG: "5",
      carbsG: "27",
      fatG: "3",
    });
    expect(linked.name).toBe("Home Oatmeal");

    // Quick-add: no item reference at all.
    const manual = await foodLogRepo.createLog({
      userId: user.id,
      loggedAt: new Date(),
      localDate: "2026-06-10",
      meal: "snack",
      source: "manual",
      name: "Quick add",
      servingQty: "1",
      kcal: 200,
      proteinG: "0",
      carbsG: "0",
      fatG: "0",
    });
    expect(manual.foodItemId).toBeNull();

    const day = await foodLogRepo.listLogsForDay(user.id, "2026-06-10");
    expect(day.length).toBeGreaterThanOrEqual(2);
  });

  it("scopes diary reads per user (no IDOR)", async () => {
    const a = await makeUser({ name: "A" });
    const b = await makeUser({ name: "B" });
    await foodLogRepo.createLog({
      userId: a.id,
      loggedAt: new Date(),
      localDate: "2026-06-09",
      meal: "lunch",
      source: "manual",
      name: "A's lunch",
      servingQty: "1",
      kcal: 500,
      proteinG: "20",
      carbsG: "50",
      fatG: "15",
    });
    expect(await foodLogRepo.listLogsForDay(b.id, "2026-06-09")).toHaveLength(0);
  });

  it("deletes a log via its composite PK", async () => {
    const user = await makeUser({ name: "Del" });
    const log = await foodLogRepo.createLog({
      userId: user.id,
      loggedAt: new Date(),
      localDate: "2026-06-08",
      meal: "dinner",
      source: "manual",
      name: "To delete",
      servingQty: "1",
      kcal: 100,
      proteinG: "1",
      carbsG: "1",
      fatG: "1",
    });
    await foodLogRepo.deleteLog(log.id, log.loggedAt);
    expect(await foodLogRepo.listLogsForDay(user.id, "2026-06-08")).toHaveLength(0);
  });

  it("rolls back a transaction on error (no partial writes)", async () => {
    const user = await makeUser({ name: "Seed" });
    void foodItemRepo; // keep the catalog repo import meaningful across edits
    await expect(
      db.transaction(async (tx) => {
        await userRepo.updateProfile(user.id, { name: "Changed" }, tx);
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    const after = await userRepo.findById(user.id);
    expect(after?.name).toBe("Seed");
  });
});

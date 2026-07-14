import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";
import { userRepo, settingsRepo } from "../../src/repositories";

// Integration suite — runs against a real test Postgres with migrations applied
// (globalSetup). Gated so `npm run test:unit` stays green without infra; enable
// with RUN_DB_TESTS=1.
const run = process.env.RUN_DB_TESTS === "1";

describe.skipIf(!run)("integration: listEligibleForWeeklyReviewPage", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeDb();
  });

  // now.getUTCHours() is also this user's local hour, since their timezone is UTC.
  const currentUtcHour = () => new Date().getUTCHours();

  it("includes a UTC user only at their matching local hour", async () => {
    const user = await makeUser({ timezone: "UTC" });

    const atHour = await userRepo.listEligibleForWeeklyReviewPage(currentUtcHour(), null, 50);
    expect(atHour.map((u) => u.id)).toContain(user.id);

    const otherHour = (currentUtcHour() + 5) % 24;
    const atOtherHour = await userRepo.listEligibleForWeeklyReviewPage(otherHour, null, 50);
    expect(atOtherHour.map((u) => u.id)).not.toContain(user.id);
  });

  it("treats a missing user_settings row as enabled", async () => {
    const user = await makeUser({ timezone: "UTC" });
    // No settings row created — DEFAULT_USER_SETTINGS never inserted for this user.
    const page = await userRepo.listEligibleForWeeklyReviewPage(currentUtcHour(), null, 50);
    expect(page.map((u) => u.id)).toContain(user.id);
  });

  it("excludes a user who has opted out via emailFoodLogReminderEnabled", async () => {
    const user = await makeUser({ timezone: "UTC" });
    await settingsRepo.updateUserSettings(user.id, { emailFoodLogReminderEnabled: false });

    const page = await userRepo.listEligibleForWeeklyReviewPage(currentUtcHour(), null, 50);
    expect(page.map((u) => u.id)).not.toContain(user.id);
  });

  it("excludes a soft-deleted user", async () => {
    const user = await makeUser({ timezone: "UTC" });
    await userRepo.softDeleteUser(user.id);

    const page = await userRepo.listEligibleForWeeklyReviewPage(currentUtcHour(), null, 50);
    expect(page.map((u) => u.id)).not.toContain(user.id);
  });

  it("excludes a user with an invalid stored timezone instead of erroring the whole query", async () => {
    const user = await makeUser({ timezone: "not-a-real-zone" });

    await expect(
      userRepo.listEligibleForWeeklyReviewPage(currentUtcHour(), null, 50)
    ).resolves.not.toThrow();
    const page = await userRepo.listEligibleForWeeklyReviewPage(currentUtcHour(), null, 50);
    expect(page.map((u) => u.id)).not.toContain(user.id);
  });

  it("falls back to UTC for a null timezone", async () => {
    const user = await makeUser({ timezone: null });
    const page = await userRepo.listEligibleForWeeklyReviewPage(currentUtcHour(), null, 50);
    expect(page.map((u) => u.id)).toContain(user.id);
  });

  it("paginates via keyset cursor", async () => {
    const users = await Promise.all(Array.from({ length: 3 }, () => makeUser({ timezone: "UTC" })));
    const ids = users.map((u) => u.id).sort();

    const firstPage = await userRepo.listEligibleForWeeklyReviewPage(currentUtcHour(), null, 2);
    expect(firstPage).toHaveLength(2);
    const secondPage = await userRepo.listEligibleForWeeklyReviewPage(
      currentUtcHour(),
      firstPage[1]!.id,
      2
    );
    const seen = [...firstPage, ...secondPage].map((u) => u.id).sort();
    expect(seen).toEqual(ids);
  });
});

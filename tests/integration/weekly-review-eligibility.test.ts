import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";
import { userRepo, settingsRepo } from "../../src/repositories";

// Integration suite — runs against a real test Postgres with migrations applied
// (globalSetup). Gated so `npm run test:unit` stays green without infra; enable
// with RUN_DB_TESTS=1.
const run = process.env.RUN_DB_TESTS === "1";

const makeVerifiedUser = (overrides: Parameters<typeof makeUser>[0] = {}) =>
  makeUser({ emailVerified: true, ...overrides });

describe.skipIf(!run)("integration: listEligibleForWeeklyReviewPage", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeDb();
  });

  const sundayAtNineUtc = new Date("2026-08-02T09:00:00.000Z");

  it("includes a UTC user on Sunday at 09:00 and excludes 08:59", async () => {
    const user = await makeVerifiedUser({ timezone: "UTC" });

    const atNine = await userRepo.listEligibleForWeeklyReviewPage(sundayAtNineUtc, null, 50);
    expect(atNine.map((u) => u.id)).toContain(user.id);

    const beforeNine = await userRepo.listEligibleForWeeklyReviewPage(
      new Date("2026-08-02T08:59:00.000Z"),
      null,
      50
    );
    expect(beforeNine.map((u) => u.id)).not.toContain(user.id);
  });

  it("never includes a UTC user on Saturday or Monday", async () => {
    const user = await makeVerifiedUser({ timezone: "UTC" });

    const saturday = await userRepo.listEligibleForWeeklyReviewPage(
      new Date("2026-08-01T09:00:00.000Z"),
      null,
      50
    );
    const monday = await userRepo.listEligibleForWeeklyReviewPage(
      new Date("2026-08-03T09:00:00.000Z"),
      null,
      50
    );

    expect(saturday.map((u) => u.id)).not.toContain(user.id);
    expect(monday.map((u) => u.id)).not.toContain(user.id);
  });

  it("supports quarter-hour timezone offsets", async () => {
    const user = await makeVerifiedUser({ timezone: "Asia/Kathmandu" });

    const atNine = await userRepo.listEligibleForWeeklyReviewPage(
      new Date("2026-08-02T03:15:00.000Z"),
      null,
      50
    );
    expect(atNine.map((u) => u.id)).toContain(user.id);
  });

  it("treats a missing user_settings row as enabled", async () => {
    const user = await makeVerifiedUser({ timezone: "UTC" });
    // No settings row created — DEFAULT_USER_SETTINGS never inserted for this user.
    const page = await userRepo.listEligibleForWeeklyReviewPage(sundayAtNineUtc, null, 50);
    expect(page.map((u) => u.id)).toContain(user.id);
  });

  it("excludes a user who has opted out of weekly reviews", async () => {
    const user = await makeVerifiedUser({ timezone: "UTC" });
    await settingsRepo.updateUserSettings(user.id, { weeklyReviewEmailEnabled: false });

    const page = await userRepo.listEligibleForWeeklyReviewPage(sundayAtNineUtc, null, 50);
    expect(page.map((u) => u.id)).not.toContain(user.id);
  });

  it("excludes a soft-deleted user", async () => {
    const user = await makeVerifiedUser({ timezone: "UTC" });
    await userRepo.softDeleteUser(user.id);

    const page = await userRepo.listEligibleForWeeklyReviewPage(sundayAtNineUtc, null, 50);
    expect(page.map((u) => u.id)).not.toContain(user.id);
  });

  it("excludes a user with an invalid stored timezone instead of erroring the whole query", async () => {
    const user = await makeVerifiedUser({ timezone: "not-a-real-zone" });

    await expect(
      userRepo.listEligibleForWeeklyReviewPage(sundayAtNineUtc, null, 50)
    ).resolves.not.toThrow();
    const page = await userRepo.listEligibleForWeeklyReviewPage(sundayAtNineUtc, null, 50);
    expect(page.map((u) => u.id)).not.toContain(user.id);
  });

  it("falls back to UTC for a null timezone", async () => {
    const user = await makeVerifiedUser({ timezone: null });
    const page = await userRepo.listEligibleForWeeklyReviewPage(sundayAtNineUtc, null, 50);
    expect(page.map((u) => u.id)).toContain(user.id);
  });

  it("paginates via keyset cursor", async () => {
    const users = await Promise.all(
      Array.from({ length: 3 }, () => makeVerifiedUser({ timezone: "UTC" }))
    );
    const ids = users.map((u) => u.id).sort();

    const firstPage = await userRepo.listEligibleForWeeklyReviewPage(sundayAtNineUtc, null, 2);
    expect(firstPage).toHaveLength(2);
    const secondPage = await userRepo.listEligibleForWeeklyReviewPage(
      sundayAtNineUtc,
      firstPage[1]!.id,
      2
    );
    const seen = [...firstPage, ...secondPage].map((u) => u.id).sort();
    expect(seen).toEqual(ids);
  });
});

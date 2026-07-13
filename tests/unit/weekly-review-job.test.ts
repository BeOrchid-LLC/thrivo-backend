import { afterEach, describe, expect, it, vi } from "vitest";

const { listEligibleForWeeklyReviewPage, hasRecentSend, getGlobalSettings } = vi.hoisted(() => ({
  listEligibleForWeeklyReviewPage: vi.fn(),
  hasRecentSend: vi.fn(),
  getGlobalSettings: vi.fn(),
}));
vi.mock("../../src/repositories", () => ({
  userRepo: { listEligibleForWeeklyReviewPage },
  emailLogRepo: { hasRecentSend },
  settingsRepo: { getGlobalSettings },
}));

const { sendTemplatedEmail } = vi.hoisted(() => ({ sendTemplatedEmail: vi.fn() }));
vi.mock("../../src/services/email.service", () => ({ sendTemplatedEmail }));

const { hasLoggedToday, getWeeklyReviewStats } = vi.hoisted(() => ({
  hasLoggedToday: vi.fn(),
  getWeeklyReviewStats: vi.fn(),
}));
vi.mock("../../src/services/weekly-review.service", () => ({
  hasLoggedToday,
  getWeeklyReviewStats,
}));

import { handleWeeklyReview } from "../../src/jobs/handlers/weekly-review";

function candidate(id: string, email: string, timezone: string | null = "UTC") {
  return { id, email, timezone };
}

describe("weekly-review job", () => {
  // resetAllMocks (not clearAllMocks): several tests queue mockResolvedValueOnce
  // pairs where the job's loop only consumes the first (a short page ends it
  // early) — clearAllMocks doesn't drain that leftover queue, so it would bleed
  // into the next test's first call.
  afterEach(() => vi.resetAllMocks());

  it("skips the whole run when disabled globally", async () => {
    getGlobalSettings.mockResolvedValue({ emailFoodLogReminderEnabled: false });

    await handleWeeklyReview({} as never);

    expect(listEligibleForWeeklyReviewPage).not.toHaveBeenCalled();
  });

  it("proceeds when there's no global_settings row yet (fail-open, matches push-token convention)", async () => {
    getGlobalSettings.mockResolvedValue(null);
    listEligibleForWeeklyReviewPage.mockResolvedValueOnce([]);

    await handleWeeklyReview({} as never);

    expect(listEligibleForWeeklyReviewPage).toHaveBeenCalledTimes(1);
  });

  it("emails eligible users who haven't logged today, and skips those who have", async () => {
    getGlobalSettings.mockResolvedValue({ emailFoodLogReminderEnabled: true });
    listEligibleForWeeklyReviewPage
      .mockResolvedValueOnce([candidate("u1", "a@x.com"), candidate("u2", "b@x.com")])
      .mockResolvedValueOnce([]);
    hasLoggedToday.mockImplementation((id: string) => Promise.resolve(id === "u2"));
    hasRecentSend.mockResolvedValue(false);
    getWeeklyReviewStats.mockResolvedValue({
      asOfLocalDate: "2024-01-15",
      loggedThisWeek: 5,
      loggedLastWeek: 3,
    });

    await handleWeeklyReview({} as never);

    expect(sendTemplatedEmail).toHaveBeenCalledTimes(1);
    expect(sendTemplatedEmail).toHaveBeenCalledWith({
      to: "a@x.com",
      userId: "u1",
      template: "weekly-review",
      props: { loggedThisWeek: 5, loggedLastWeek: 3 },
    });
  });

  it("does not double-send within the dedupe window", async () => {
    getGlobalSettings.mockResolvedValue({ emailFoodLogReminderEnabled: true });
    listEligibleForWeeklyReviewPage
      .mockResolvedValueOnce([candidate("u1", "a@x.com")])
      .mockResolvedValueOnce([]);
    hasLoggedToday.mockResolvedValue(false);
    hasRecentSend.mockResolvedValue(true);

    await handleWeeklyReview({} as never);

    expect(sendTemplatedEmail).not.toHaveBeenCalled();
  });

  it("pages through eligible users via keyset cursor until a short page ends the loop", async () => {
    getGlobalSettings.mockResolvedValue({ emailFoodLogReminderEnabled: true });
    // A full PAGE_SIZE (200) page forces one more fetch; the second, short page ends the loop.
    const fullPage = Array.from({ length: 200 }, (_, i) => candidate(`u${i}`, `u${i}@x.com`));
    listEligibleForWeeklyReviewPage.mockResolvedValueOnce(fullPage).mockResolvedValueOnce([]);
    hasLoggedToday.mockResolvedValue(true); // no sends needed — just exercising the paging loop

    await handleWeeklyReview({} as never);

    expect(listEligibleForWeeklyReviewPage).toHaveBeenCalledTimes(2);
    expect(listEligibleForWeeklyReviewPage.mock.calls[1]?.[1]).toBe("u199"); // cursor advanced past the last row
  });
});

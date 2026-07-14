import { afterEach, describe, expect, it, vi } from "vitest";

const { listEligibleForWeeklyReviewPage, listRecentSends, getGlobalSettings } = vi.hoisted(() => ({
  listEligibleForWeeklyReviewPage: vi.fn(),
  listRecentSends: vi.fn(),
  getGlobalSettings: vi.fn(),
}));
vi.mock("../../src/repositories", () => ({
  userRepo: { listEligibleForWeeklyReviewPage },
  emailLogRepo: { listRecentSends },
  settingsRepo: { getGlobalSettings },
}));

const { sendTemplatedEmail } = vi.hoisted(() => ({ sendTemplatedEmail: vi.fn() }));
vi.mock("../../src/services/email.service", () => ({ sendTemplatedEmail }));

const { getWeeklyReviewBatch } = vi.hoisted(() => ({ getWeeklyReviewBatch: vi.fn() }));
vi.mock("../../src/services/weekly-review.service", () => ({ getWeeklyReviewBatch }));

import { handleWeeklyReview } from "../../src/jobs/handlers/weekly-review";

function candidate(id: string, email: string, timezone: string | null = "UTC") {
  return { id, email, timezone };
}

function batchFor(page: Array<{ id: string }>, loggedToday = false) {
  return {
    byUserId: new Map(
      page.map((user) => [
        user.id,
        {
          asOfLocalDate: "2024-01-15",
          loggedToday,
          loggedThisWeek: 5,
          loggedLastWeek: 3,
        },
      ])
    ),
    skippedUnsupportedTimezone: 0,
  };
}

describe("weekly-review job", () => {
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
    const page = [candidate("u1", "a@x.com"), candidate("u2", "b@x.com")];
    listEligibleForWeeklyReviewPage.mockResolvedValueOnce(page).mockResolvedValueOnce([]);
    getWeeklyReviewBatch.mockResolvedValue({
      ...batchFor(page),
      byUserId: new Map([
        [
          "u1",
          { asOfLocalDate: "2024-01-15", loggedToday: false, loggedThisWeek: 5, loggedLastWeek: 3 },
        ],
        [
          "u2",
          { asOfLocalDate: "2024-01-15", loggedToday: true, loggedThisWeek: 5, loggedLastWeek: 3 },
        ],
      ]),
    });
    listRecentSends.mockResolvedValue(new Set());

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
    const page = [candidate("u1", "a@x.com")];
    listEligibleForWeeklyReviewPage.mockResolvedValueOnce(page).mockResolvedValueOnce([]);
    getWeeklyReviewBatch.mockResolvedValue(batchFor(page));
    listRecentSends.mockResolvedValue(new Set(["u1"]));

    await handleWeeklyReview({} as never);

    expect(sendTemplatedEmail).not.toHaveBeenCalled();
  });

  it("continues after one user's send fails", async () => {
    getGlobalSettings.mockResolvedValue({ emailFoodLogReminderEnabled: true });
    const page = [candidate("u1", "a@x.com"), candidate("u2", "b@x.com")];
    listEligibleForWeeklyReviewPage.mockResolvedValueOnce(page).mockResolvedValueOnce([]);
    getWeeklyReviewBatch.mockResolvedValue(batchFor(page));
    listRecentSends.mockResolvedValue(new Set());
    sendTemplatedEmail
      .mockRejectedValueOnce(new Error("provider failed"))
      .mockResolvedValueOnce({});

    await handleWeeklyReview({} as never);

    expect(sendTemplatedEmail).toHaveBeenCalledTimes(2);
  });

  it("pages through eligible users via keyset cursor until a short page ends the loop", async () => {
    getGlobalSettings.mockResolvedValue({ emailFoodLogReminderEnabled: true });
    const fullPage = Array.from({ length: 200 }, (_, i) => candidate(`u${i}`, `u${i}@x.com`));
    listEligibleForWeeklyReviewPage.mockResolvedValueOnce(fullPage).mockResolvedValueOnce([]);
    getWeeklyReviewBatch.mockResolvedValue(batchFor(fullPage, true));
    listRecentSends.mockResolvedValue(new Set());

    await handleWeeklyReview({} as never);

    expect(listEligibleForWeeklyReviewPage).toHaveBeenCalledTimes(2);
    expect(listEligibleForWeeklyReviewPage.mock.calls[1]?.[1]).toBe("u199");
  });
});

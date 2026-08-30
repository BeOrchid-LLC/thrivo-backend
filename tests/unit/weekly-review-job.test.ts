import { afterEach, describe, expect, it, vi } from "vitest";

const { listEligibleForWeeklyReviewPage, getGlobalSettings } = vi.hoisted(() => ({
  listEligibleForWeeklyReviewPage: vi.fn(),
  getGlobalSettings: vi.fn(),
}));
vi.mock("../../src/repositories", () => ({
  userRepo: { listEligibleForWeeklyReviewPage },
  settingsRepo: { getGlobalSettings },
}));

const { queueTemplatedEmail } = vi.hoisted(() => ({ queueTemplatedEmail: vi.fn() }));
vi.mock("../../src/services/email.service", () => ({ queueTemplatedEmail }));

const { getWeeklyReviewBatch } = vi.hoisted(() => ({ getWeeklyReviewBatch: vi.fn() }));
vi.mock("../../src/services/weekly-review.service", () => ({ getWeeklyReviewBatch }));

import { handleWeeklyReview } from "../../src/jobs/handlers/weekly-review";

function candidate(id: string, email: string, timezone: string | null = "UTC") {
  return { id, email, timezone, createdAt: new Date("2023-12-01T00:00:00Z") };
}

function batchFor(page: Array<{ id: string }>) {
  return {
    byUserId: new Map(
      page.map((user) => [
        user.id,
        {
          sendLocalDate: "2024-01-21",
          periodStart: "2024-01-14",
          periodEnd: "2024-01-20",
          loggedDays: 5,
          previousLoggedDays: 3,
          includeComparison: true,
          joinedDuringPeriod: false,
        },
      ])
    ),
    skippedUnsupportedTimezone: 0,
  };
}

describe("weekly-review job", () => {
  afterEach(() => vi.clearAllMocks());

  it("skips the whole run when weekly reviews are disabled globally", async () => {
    getGlobalSettings.mockResolvedValue({ weeklyReviewEmailEnabled: false });

    await handleWeeklyReview({} as never);

    expect(listEligibleForWeeklyReviewPage).not.toHaveBeenCalled();
  });

  it("proceeds when there is no global settings row", async () => {
    getGlobalSettings.mockResolvedValue(null);
    listEligibleForWeeklyReviewPage.mockResolvedValueOnce([]);

    await handleWeeklyReview({} as never);

    expect(listEligibleForWeeklyReviewPage).toHaveBeenCalledTimes(1);
  });

  it("queues every eligible user with period-semantic deduplication", async () => {
    getGlobalSettings.mockResolvedValue({ weeklyReviewEmailEnabled: true });
    const page = [candidate("u1", "a@x.com"), candidate("u2", "b@x.com")];
    listEligibleForWeeklyReviewPage.mockResolvedValueOnce(page);
    getWeeklyReviewBatch.mockResolvedValue(batchFor(page));

    await handleWeeklyReview({} as never);

    expect(queueTemplatedEmail).toHaveBeenCalledTimes(2);
    expect(queueTemplatedEmail).toHaveBeenCalledWith({
      kind: "weekly_review",
      to: "a@x.com",
      userId: "u1",
      template: "weekly-review",
      resendable: true,
      dedupeKey: "weekly-review:u1:2024-01-14",
      expiresAt: new Date("2024-01-22T00:00:00.000Z"),
      props: {
        periodStart: "2024-01-14",
        periodEnd: "2024-01-20",
        loggedDays: 5,
        previousLoggedDays: 3,
        includeComparison: true,
        joinedDuringPeriod: false,
        progressUrl: expect.stringMatching(/\/metrics$/),
      },
    });
  });

  it("continues after one recipient fails to queue", async () => {
    getGlobalSettings.mockResolvedValue({ weeklyReviewEmailEnabled: true });
    const page = [candidate("u1", "a@x.com"), candidate("u2", "b@x.com")];
    listEligibleForWeeklyReviewPage.mockResolvedValueOnce(page);
    getWeeklyReviewBatch.mockResolvedValue(batchFor(page));
    queueTemplatedEmail.mockRejectedValueOnce(new Error("database unavailable"));

    await handleWeeklyReview({} as never);

    expect(queueTemplatedEmail).toHaveBeenCalledTimes(2);
  });

  it("supports candidate and calculation dry runs without creating outbox rows", async () => {
    getGlobalSettings.mockResolvedValue({ weeklyReviewEmailEnabled: true });
    const page = [candidate("u1", "a@x.com")];
    listEligibleForWeeklyReviewPage.mockResolvedValueOnce(page);
    getWeeklyReviewBatch.mockResolvedValue(batchFor(page));

    await handleWeeklyReview({} as never, { dryRun: true });

    expect(getWeeklyReviewBatch).toHaveBeenCalledWith(page, expect.any(Date));
    expect(queueTemplatedEmail).not.toHaveBeenCalled();
  });

  it("pages through eligible users via a keyset cursor", async () => {
    getGlobalSettings.mockResolvedValue({ weeklyReviewEmailEnabled: true });
    const fullPage = Array.from({ length: 200 }, (_, index) =>
      candidate(`u${index}`, `u${index}@x.com`)
    );
    listEligibleForWeeklyReviewPage.mockResolvedValueOnce(fullPage).mockResolvedValueOnce([]);
    getWeeklyReviewBatch.mockResolvedValue(batchFor(fullPage));

    await handleWeeklyReview({} as never);

    expect(listEligibleForWeeklyReviewPage).toHaveBeenCalledTimes(2);
    expect(listEligibleForWeeklyReviewPage.mock.calls[1]?.[1]).toBe("u199");
  });
});

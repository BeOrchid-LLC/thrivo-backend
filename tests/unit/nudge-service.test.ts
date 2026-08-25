import { beforeEach, describe, expect, it, vi } from "vitest";

const { tipRepo, pushTokenRepo, enqueue, settingsRepo } = vi.hoisted(() => ({
  tipRepo: { getPinnedForDate: vi.fn(), listActive: vi.fn() },
  pushTokenRepo: { listActiveForNudgesPage: vi.fn(), pruneInvalid: vi.fn() },
  enqueue: vi.fn(),
  settingsRepo: { getGlobalSettings: vi.fn(), upsertGlobalDefaults: vi.fn() },
}));
vi.mock("../../src/repositories", () => ({ tipRepo, pushTokenRepo, settingsRepo }));
vi.mock("../../src/lib/queue", () => ({
  enqueue,
  QUEUE_NAMES: { nudges: "nudges", emails: "emails", maintenance: "maintenance" },
}));

import { selectDailyTip, sendDailyNudges } from "../../src/services/nudge.service";

function tip(id: string) {
  return {
    id,
    body: `tip ${id}`,
    mood: null,
    isActive: true,
    pinnedDate: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const dayIndex = (iso: string, len: number) =>
  Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000) % len;

describe("selectDailyTip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tipRepo.getPinnedForDate.mockResolvedValue(null);
  });

  it("prefers a staff-pinned tip for the date", async () => {
    tipRepo.getPinnedForDate.mockResolvedValue(tip("pinned"));
    tipRepo.listActive.mockResolvedValue([tip("a"), tip("b")]);
    expect((await selectDailyTip("2026-06-28"))?.id).toBe("pinned");
  });

  it("rotates deterministically by day over the active bank", async () => {
    const bank = [tip("a"), tip("b"), tip("c")];
    tipRepo.listActive.mockResolvedValue(bank);

    // Same date → same tip (stable across calls).
    expect((await selectDailyTip("2026-06-28"))?.id).toBe(bank[dayIndex("2026-06-28", 3)].id);
    // Next day advances by one (mod length).
    expect((await selectDailyTip("2026-06-29"))?.id).toBe(bank[dayIndex("2026-06-29", 3)].id);
  });

  it("returns null when the bank is empty", async () => {
    tipRepo.listActive.mockResolvedValue([]);
    expect(await selectDailyTip("2026-06-28")).toBeNull();
  });
});

function pushToken(id: string) {
  return { id, expoPushToken: `token-${id}` };
}

describe("sendDailyNudges dispatcher (R5-3 / I15)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tipRepo.getPinnedForDate.mockResolvedValue(null);
    tipRepo.listActive.mockResolvedValue([tip("t1")]);
    settingsRepo.getGlobalSettings.mockResolvedValue({
      pushNotificationsEnabled: true,
      psychologyTipPushEnabled: true,
    });
  });

  it("skips dispatch entirely when there is no active tip", async () => {
    tipRepo.listActive.mockResolvedValue([]);

    const result = await sendDailyNudges("2026-06-28");

    expect(result).toEqual({ tipId: null, chunksEnqueued: 0, tokensQueued: 0 });
    expect(pushTokenRepo.listActiveForNudgesPage).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("enqueues one chunk job per Expo-sized (100) batch, paging by keyset cursor", async () => {
    const page1 = Array.from({ length: 500 }, (_, i) => pushToken(String(i + 1).padStart(4, "0")));
    const page2 = Array.from({ length: 120 }, (_, i) =>
      pushToken(String(i + 501).padStart(4, "0"))
    );
    pushTokenRepo.listActiveForNudgesPage
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2)
      .mockResolvedValueOnce([]);

    const result = await sendDailyNudges("2026-06-28");

    // 500 + 120 = 620 tokens -> 7 chunks of 100 (last one partial, 20 tokens).
    expect(result.chunksEnqueued).toBe(7);
    expect(result.tokensQueued).toBe(620);
    expect(
      enqueue.mock.calls.every(
        ([queue, jobName]) => queue === "nudges" && jobName === "send-nudge-chunk"
      )
    ).toBe(true);
    const lastChunk = enqueue.mock.calls[enqueue.mock.calls.length - 1]![2] as { tokens: string[] };
    expect(lastChunk.tokens).toHaveLength(20);

    // Cursor passed to the second page fetch is the last id of the first page.
    expect(pushTokenRepo.listActiveForNudgesPage).toHaveBeenNthCalledWith(2, "0500", 500);
    // Loop stops once a page comes back shorter than the page size.
    expect(pushTokenRepo.listActiveForNudgesPage).toHaveBeenCalledTimes(2);
  });

  it("returns zero chunks when no tokens are eligible", async () => {
    pushTokenRepo.listActiveForNudgesPage.mockResolvedValueOnce([]);

    const result = await sendDailyNudges("2026-06-28");

    expect(result).toEqual({ tipId: "t1", chunksEnqueued: 0, tokensQueued: 0 });
    expect(enqueue).not.toHaveBeenCalled();
  });
});

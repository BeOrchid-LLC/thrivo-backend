import { beforeEach, describe, expect, it, vi } from "vitest";

const { tipRepo, pushTokenRepo } = vi.hoisted(() => ({
  tipRepo: { getPinnedForDate: vi.fn(), listActive: vi.fn() },
  pushTokenRepo: { listActiveForNudges: vi.fn(), pruneInvalid: vi.fn() },
}));
vi.mock("../../src/repositories", () => ({ tipRepo, pushTokenRepo }));

import { selectDailyTip } from "../../src/services/nudge.service";

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

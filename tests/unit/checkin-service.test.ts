import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkInRepo, tipRepo } = vi.hoisted(() => ({
  checkInRepo: { upsertForDay: vi.fn(), listForUser: vi.fn() },
  tipRepo: { findByIds: vi.fn() },
}));
const { selectDailyTip } = vi.hoisted(() => ({ selectDailyTip: vi.fn() }));
vi.mock("../../src/repositories", () => ({ checkInRepo, tipRepo }));
vi.mock("../../src/services/nudge.service", () => ({ selectDailyTip }));

import { createCheckin, listCheckins } from "../../src/services/checkin.service";

const user = { id: "u1" } as Parameters<typeof createCheckin>[0];

describe("createCheckin", () => {
  beforeEach(() => vi.clearAllMocks());

  it("upserts the day's check-in and returns it with the daily tip", async () => {
    selectDailyTip.mockResolvedValue({ id: "tip1", body: "Be kind to yourself." });
    checkInRepo.upsertForDay.mockResolvedValue({
      id: "c1",
      userId: "u1",
      localDate: "2026-06-29",
      mood: "good",
      note: "ok day",
      tipId: "tip1",
      createdAt: new Date("2026-06-29T08:00:00Z"),
    });

    const res = await createCheckin(user, { mood: "good", day: "2026-06-29", note: "ok day" });

    expect(checkInRepo.upsertForDay).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        localDate: "2026-06-29",
        mood: "good",
        tipId: "tip1",
      })
    );
    expect(res.checkin).toMatchObject({
      id: "c1",
      mood: "good",
      day: "2026-06-29",
      note: "ok day",
      tip: "Be kind to yourself.",
    });
  });

  it("tolerates an empty tip bank", async () => {
    selectDailyTip.mockResolvedValue(null);
    checkInRepo.upsertForDay.mockResolvedValue({
      id: "c2",
      userId: "u1",
      localDate: "2026-06-29",
      mood: "low",
      note: null,
      tipId: null,
      createdAt: new Date(),
    });

    const res = await createCheckin(user, { mood: "low", day: "2026-06-29" });
    expect(res.checkin.tip).toBeNull();
    expect(res.checkin.note).toBeNull();
  });
});

describe("listCheckins", () => {
  beforeEach(() => vi.clearAllMocks());

  it("attaches tip bodies by id and leaves untipped check-ins null", async () => {
    checkInRepo.listForUser.mockResolvedValue([
      {
        id: "c1",
        localDate: "2026-06-29",
        mood: "good",
        note: null,
        tipId: "tip1",
        createdAt: new Date(),
      },
      {
        id: "c2",
        localDate: "2026-06-28",
        mood: "bad",
        note: "rough",
        tipId: null,
        createdAt: new Date(),
      },
    ]);
    tipRepo.findByIds.mockResolvedValue(new Map([["tip1", { id: "tip1", body: "Tip one" }]]));

    const res = await listCheckins(user);

    expect(res.checkins[0]).toMatchObject({ id: "c1", tip: "Tip one" });
    expect(res.checkins[1]).toMatchObject({ id: "c2", tip: null, note: "rough" });
  });
});

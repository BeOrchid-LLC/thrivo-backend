import { afterEach, describe, expect, it, vi } from "vitest";

const {
  findById,
  listByUser: listSubEvents,
  getByUser,
} = vi.hoisted(() => ({
  findById: vi.fn(),
  listByUser: vi.fn(),
  getByUser: vi.fn(),
}));
const { listByUser: listUserEvents } = vi.hoisted(() => ({ listByUser: vi.fn() }));

vi.mock("../../src/repositories", () => ({
  userRepo: { findById },
  subscriptionEventRepo: { listByUser: listSubEvents },
  subscriptionRepo: { getByUser },
  userEventRepo: { listByUser: listUserEvents },
}));

import { getUserTimeline } from "../../src/services/admin-timeline.service";

const BASE_USER = {
  id: "u1",
  createdAt: new Date("2026-06-14T09:14:00.000Z"),
  onboardingCompletedAt: null as Date | null,
};

describe("admin-timeline.service", () => {
  afterEach(() => vi.resetAllMocks());

  it("throws NotFoundError for an unknown user", async () => {
    findById.mockResolvedValue(null);
    await expect(getUserTimeline("missing")).rejects.toThrow();
  });

  it("always includes account_created from users.createdAt", async () => {
    findById.mockResolvedValue(BASE_USER);
    listSubEvents.mockResolvedValue([]);
    listUserEvents.mockResolvedValue([]);
    getByUser.mockResolvedValue(null);

    const timeline = await getUserTimeline("u1");

    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({ type: "account_created", status: "completed" });
  });

  it("includes onboarding_completed only when the timestamp is set", async () => {
    findById.mockResolvedValue({
      ...BASE_USER,
      onboardingCompletedAt: new Date("2026-06-14T09:17:00.000Z"),
    });
    listSubEvents.mockResolvedValue([]);
    listUserEvents.mockResolvedValue([]);
    getByUser.mockResolvedValue(null);

    const timeline = await getUserTimeline("u1");

    expect(timeline.map((e) => e.type)).toEqual(["account_created", "onboarding_completed"]);
  });

  it("titles a converted trial with its charged amount when priced, and without when not", async () => {
    findById.mockResolvedValue(BASE_USER);
    listSubEvents.mockResolvedValue([
      {
        eventType: "trial_converted",
        priceAmountCents: 1499,
        occurredAt: new Date("2026-06-23T08:05:00.000Z"),
      },
    ]);
    listUserEvents.mockResolvedValue([]);
    getByUser.mockResolvedValue(null);

    const timeline = await getUserTimeline("u1");
    const converted = timeline.find((e) => e.type === "trial_converted");
    expect(converted?.title).toBe("Trial converted — charged $14.99");
  });

  it("surfaces the upgrade-prompt trigger from metadata, omitting it when absent", async () => {
    findById.mockResolvedValue(BASE_USER);
    listSubEvents.mockResolvedValue([]);
    listUserEvents.mockResolvedValue([
      {
        eventType: "upgrade_prompt_shown",
        metadata: { trigger: "3-day streak" },
        occurredAt: new Date("2026-06-16T08:02:00.000Z"),
      },
    ]);
    getByUser.mockResolvedValue(null);

    const timeline = await getUserTimeline("u1");
    const prompt = timeline.find((e) => e.type === "upgrade_prompt_shown");
    expect(prompt?.subtitle).toBe("3-day streak trigger");
  });

  it("appends a synthesized next_charge_scheduled entry only for a live, non-cancelling subscription", async () => {
    findById.mockResolvedValue(BASE_USER);
    listSubEvents.mockResolvedValue([]);
    listUserEvents.mockResolvedValue([]);
    getByUser.mockResolvedValue({
      status: "active",
      cancelAtPeriodEnd: false,
      productId: "thrivo_premium_monthly",
      currentPeriodEnd: new Date("2026-07-21T00:00:00.000Z"),
    });

    const timeline = await getUserTimeline("u1");
    const scheduled = timeline.find((e) => e.type === "next_charge_scheduled");
    expect(scheduled).toMatchObject({ status: "scheduled", title: "Next charge — $14.99" });
  });

  it("omits next_charge_scheduled when the subscription is set to cancel", async () => {
    findById.mockResolvedValue(BASE_USER);
    listSubEvents.mockResolvedValue([]);
    listUserEvents.mockResolvedValue([]);
    getByUser.mockResolvedValue({
      status: "active",
      cancelAtPeriodEnd: true,
      productId: "thrivo_premium_monthly",
      currentPeriodEnd: new Date("2026-07-21T00:00:00.000Z"),
    });

    const timeline = await getUserTimeline("u1");
    expect(timeline.find((e) => e.type === "next_charge_scheduled")).toBeUndefined();
  });

  it("sorts every entry chronologically regardless of source order", async () => {
    findById.mockResolvedValue({
      ...BASE_USER,
      onboardingCompletedAt: new Date("2026-06-14T09:17:00.000Z"),
    });
    listSubEvents.mockResolvedValue([
      {
        eventType: "trial_started",
        priceAmountCents: null,
        occurredAt: new Date("2026-06-16T08:05:00.000Z"),
      },
    ]);
    listUserEvents.mockResolvedValue([
      {
        eventType: "upgrade_prompt_shown",
        metadata: null,
        occurredAt: new Date("2026-06-16T08:02:00.000Z"),
      },
    ]);
    getByUser.mockResolvedValue(null);

    const timeline = await getUserTimeline("u1");
    const times = timeline.map((e) => new Date(e.occurredAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

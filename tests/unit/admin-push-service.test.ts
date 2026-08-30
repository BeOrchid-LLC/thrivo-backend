import { afterEach, describe, expect, it, vi } from "vitest";

const { claimForManualSend, findById, findRowById, restoreAfterEnqueueFailure, claimDueScheduled } =
  vi.hoisted(() => ({
    claimForManualSend: vi.fn(),
    findById: vi.fn(),
    findRowById: vi.fn(),
    restoreAfterEnqueueFailure: vi.fn(),
    claimDueScheduled: vi.fn(),
  }));
const { enqueue } = vi.hoisted(() => ({ enqueue: vi.fn() }));
const { error } = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock("../../src/repositories", () => ({
  pushCampaignRepo: {
    claimForManualSend,
    findById,
    findRowById,
    restoreAfterEnqueueFailure,
    claimDueScheduled,
  },
}));
vi.mock("../../src/lib/queue", () => ({
  enqueue,
  QUEUE_NAMES: { nudges: "nudges" },
}));
vi.mock("../../src/lib/logger", () => ({ logger: { error, info: vi.fn(), warn: vi.fn() } }));
vi.mock("../../src/env", () => ({ env: { ADMIN_PUSH_LIFECYCLE_ENABLED: true } }));

import {
  dispatchDueCampaigns,
  queueCampaignTest,
  sendCampaign,
} from "../../src/services/admin-push.service";

const campaign = {
  id: "campaign-1",
  title: "A title",
  body: "A body",
  scheduledAt: null,
  status: "draft",
} as const;

describe("admin push campaign service", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("restores a draft when a manual send cannot be enqueued", async () => {
    claimForManualSend.mockResolvedValue(campaign);
    enqueue.mockRejectedValue(new Error("redis unavailable"));

    await expect(sendCampaign(campaign.id)).rejects.toThrow("redis unavailable");

    expect(restoreAfterEnqueueFailure).toHaveBeenCalledWith(campaign.id, "draft");
    expect(findRowById).not.toHaveBeenCalled();
  });

  it("continues dispatching due campaigns when one enqueue fails", async () => {
    const second = { ...campaign, id: "campaign-2", status: "scheduled" as const };
    claimDueScheduled.mockResolvedValue([campaign, second]);
    enqueue.mockRejectedValueOnce(new Error("temporary redis failure")).mockResolvedValueOnce();

    await expect(dispatchDueCampaigns()).resolves.toBe(1);

    expect(restoreAfterEnqueueFailure).toHaveBeenCalledWith(campaign.id, "scheduled");
    expect(restoreAfterEnqueueFailure).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenNthCalledWith(1, "nudges", "send-campaign", {
      campaignId: campaign.id,
    });
    expect(enqueue).toHaveBeenNthCalledWith(2, "nudges", "send-campaign", {
      campaignId: second.id,
    });
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: campaign.id }),
      "scheduled campaign enqueue failed"
    );
  });

  it("uses a deterministic job id for a campaign test send", async () => {
    findRowById.mockResolvedValue(campaign);
    enqueue.mockResolvedValue(undefined);

    await queueCampaignTest(campaign.id, "request-123");

    expect(enqueue).toHaveBeenCalledWith(
      "nudges",
      "send-campaign-test",
      { campaignId: campaign.id },
      { jobId: "admin-push-test:campaign-1:request-123" }
    );
  });
});

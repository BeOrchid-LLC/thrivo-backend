import { afterEach, describe, expect, it, vi } from "vitest";

const {
  findById,
  resolveRecipients,
  insertRecipients,
  claimQueuedRecipients,
  recipientCounts,
  markRecipients,
  setStatus,
  pruneInvalid,
} = vi.hoisted(() => ({
  findById: vi.fn(),
  resolveRecipients: vi.fn(),
  insertRecipients: vi.fn(),
  claimQueuedRecipients: vi.fn(),
  recipientCounts: vi.fn(),
  markRecipients: vi.fn(),
  setStatus: vi.fn(),
  pruneInvalid: vi.fn(),
}));
const { sendExpoPushBatch } = vi.hoisted(() => ({ sendExpoPushBatch: vi.fn() }));

vi.mock("../../src/repositories", () => ({
  pushCampaignRepo: {
    findById,
    resolveRecipients,
    insertRecipients,
    claimQueuedRecipients,
    recipientCounts,
    markRecipients,
    setStatus,
  },
  pushTokenRepo: { pruneInvalid },
}));
vi.mock("../../src/integrations/expo-push", () => ({
  EXPO_MAX_PER_REQUEST: 100,
  sendExpoPushBatch,
}));
vi.mock("../../src/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

import { handleSendCampaign } from "../../src/jobs/handlers/send-campaign";

const campaign = {
  id: "campaign-1",
  title: "A title",
  body: "A body",
  deepLink: null,
  segment: { all: true },
  status: "sending",
} as const;

const job = { data: { campaignId: campaign.id } } as never;

describe("send campaign worker", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("claims recipients before sending and finalizes only after the claim is complete", async () => {
    findById.mockResolvedValue(campaign);
    resolveRecipients.mockResolvedValue([{ userId: "user-1", token: "ExponentPushToken[1]" }]);
    recipientCounts.mockResolvedValueOnce({ recipientCount: 1 }).mockResolvedValueOnce({
      recipientCount: 1,
      sentCount: 1,
      failedCount: 0,
      queuedCount: 0,
      processingCount: 0,
    });
    claimQueuedRecipients
      .mockResolvedValueOnce([
        {
          id: "recipient-1",
          userId: "user-1",
          token: "ExponentPushToken[1]",
          processingToken: "claim-1",
        },
      ])
      .mockResolvedValueOnce([]);
    sendExpoPushBatch.mockResolvedValue({ invalidTokens: [] });

    await handleSendCampaign(job);

    expect(claimQueuedRecipients).toHaveBeenCalledWith(campaign.id, 100);
    expect(sendExpoPushBatch).toHaveBeenCalledWith([
      { to: "ExponentPushToken[1]", title: "A title", body: "A body", data: undefined },
    ]);
    expect(markRecipients).toHaveBeenCalledWith(
      campaign.id,
      ["recipient-1"],
      "sent",
      null,
      "claim-1"
    );
    expect(setStatus).toHaveBeenLastCalledWith(campaign.id, "sent", {
      recipientCount: 1,
      sentCount: 1,
      failedCount: 0,
      sentAt: expect.any(Date),
    });
  });

  it("does not mark a campaign complete while another worker owns a recipient lease", async () => {
    findById.mockResolvedValue(campaign);
    resolveRecipients.mockResolvedValue([{ userId: "user-1", token: "ExponentPushToken[1]" }]);
    recipientCounts.mockResolvedValueOnce({ recipientCount: 1 }).mockResolvedValueOnce({
      recipientCount: 1,
      sentCount: 0,
      failedCount: 0,
      queuedCount: 0,
      processingCount: 1,
    });
    claimQueuedRecipients.mockResolvedValue([]);

    await handleSendCampaign(job);

    expect(sendExpoPushBatch).not.toHaveBeenCalled();
    expect(setStatus).toHaveBeenCalledTimes(1);
    expect(setStatus).toHaveBeenCalledWith(campaign.id, "sending", { recipientCount: 1 });
  });
});

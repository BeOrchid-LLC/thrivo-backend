import type { Job } from "bullmq";
import { afterEach, describe, expect, it, vi } from "vitest";

const { sendExpoPushBatch } = vi.hoisted(() => ({ sendExpoPushBatch: vi.fn() }));
vi.mock("../../src/integrations/expo-push", async (importActual) => {
  const actual = await importActual<typeof import("../../src/integrations/expo-push")>();
  return { ...actual, sendExpoPushBatch };
});

const { pruneInvalid } = vi.hoisted(() => ({ pruneInvalid: vi.fn() }));
vi.mock("../../src/repositories", () => ({ pushTokenRepo: { pruneInvalid } }));

import { handleSendNudgeChunk } from "../../src/jobs/handlers/send-nudge-chunk";
import type { NudgeChunkJobData } from "../../src/services/nudge.service";

function job(data: Partial<NudgeChunkJobData> = {}): Job<NudgeChunkJobData> {
  return {
    data: { tipId: "tip_1", tipBody: "Drink water", tokens: ["tok-a", "tok-b"], ...data },
  } as Job<NudgeChunkJobData>;
}

describe("send-nudge-chunk handler (R5-3 / I15)", () => {
  afterEach(() => vi.clearAllMocks());

  it("sends exactly one Expo batch for the chunk's tokens", async () => {
    sendExpoPushBatch.mockResolvedValue({ invalidTokens: [] });

    await handleSendNudgeChunk(job());

    expect(sendExpoPushBatch).toHaveBeenCalledTimes(1);
    const [messages] = sendExpoPushBatch.mock.calls[0];
    expect(messages).toEqual([
      {
        to: "tok-a",
        title: "Thrivo",
        body: "Drink water",
        data: { screen: "checkin", tipId: "tip_1" },
      },
      {
        to: "tok-b",
        title: "Thrivo",
        body: "Drink water",
        data: { screen: "checkin", tipId: "tip_1" },
      },
    ]);
  });

  it("prunes tokens Expo reports as dead", async () => {
    sendExpoPushBatch.mockResolvedValue({ invalidTokens: ["tok-a"] });

    await handleSendNudgeChunk(job());

    expect(pruneInvalid).toHaveBeenCalledWith(["tok-a"]);
  });

  it("skips the prune call when nothing is invalid", async () => {
    sendExpoPushBatch.mockResolvedValue({ invalidTokens: [] });

    await handleSendNudgeChunk(job());

    expect(pruneInvalid).not.toHaveBeenCalled();
  });

  it("propagates a batch failure so BullMQ retries only this chunk", async () => {
    sendExpoPushBatch.mockRejectedValue(new Error("Expo push failed with status 500"));

    await expect(handleSendNudgeChunk(job())).rejects.toThrow("status 500");
  });
});

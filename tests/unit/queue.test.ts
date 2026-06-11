import { afterEach, describe, expect, it, vi } from "vitest";

// Replace BullMQ's Queue with a fake whose add() fails, so we exercise enqueue's
// error path without a live Redis.
const { add } = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock("bullmq", () => ({
  Queue: class {
    add = add;
    close = vi.fn(async () => {});
  },
}));

import { enqueue, getQueue, closeQueues, QUEUE_NAMES } from "../../src/lib/queue";

describe("queue seam", () => {
  afterEach(async () => {
    await closeQueues();
    vi.clearAllMocks();
  });

  it("rethrows (never swallows) when the underlying add fails", async () => {
    add.mockRejectedValueOnce(new Error("redis down"));
    await expect(enqueue(QUEUE_NAMES.emails, "send-email", { x: 1 })).rejects.toThrow("redis down");
  });

  it("reuses one Queue instance per name", async () => {
    expect(getQueue(QUEUE_NAMES.nudges)).toBe(getQueue(QUEUE_NAMES.nudges));
  });
});

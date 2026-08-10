import { afterEach, describe, expect, it, vi } from "vitest";

const { transaction } = vi.hoisted(() => ({
  transaction: vi.fn(async (callback: (tx: object) => Promise<unknown>) => callback({})),
}));
vi.mock("../../db", () => ({ db: { transaction } }));

vi.mock("../../src/env", () => ({ env: { EMAIL_SENDING_ENABLED: true } }));
vi.mock("../../src/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

const { enqueue, getJob, remove } = vi.hoisted(() => ({
  enqueue: vi.fn(),
  getJob: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("../../src/lib/queue", () => ({
  QUEUE_NAMES: { emails: "emails" },
  enqueue,
  getQueue: () => ({ getJob }),
}));

const {
  expirePastDue,
  claimDispatchBatch,
  complete,
  releaseForDispatch,
  markDispatched,
  terminal,
} = vi.hoisted(() => ({
  expirePastDue: vi.fn(),
  claimDispatchBatch: vi.fn(),
  complete: vi.fn(),
  releaseForDispatch: vi.fn(),
  markDispatched: vi.fn(),
  terminal: vi.fn(),
}));
vi.mock("../../src/repositories", () => ({
  emailOutboxRepo: {
    expirePastDue,
    claimDispatchBatch,
    complete,
    releaseForDispatch,
    markDispatched,
  },
  emailLogRepo: { markTerminalFailure: terminal },
}));

import { handleRelayEmailOutbox } from "../../src/jobs/handlers/relay-email-outbox";

describe("email outbox relay", () => {
  afterEach(() => vi.clearAllMocks());

  it("terminalizes an exhausted Bull job instead of creating an unbounded retry horizon", async () => {
    expirePastDue.mockResolvedValue(0);
    claimDispatchBatch.mockResolvedValue(["log_1"]);
    getJob.mockResolvedValue({
      attemptsMade: 6,
      opts: { attempts: 6 },
      getState: vi.fn().mockResolvedValue("failed"),
      remove,
    });

    await handleRelayEmailOutbox();

    expect(enqueue).not.toHaveBeenCalled();
    expect(terminal).toHaveBeenCalledWith(
      "log_1",
      "failed",
      "retry_exhausted",
      "Email delivery retry horizon exhausted",
      expect.any(Object)
    );
    expect(complete).toHaveBeenCalledWith("log_1", "failed", expect.any(Object));
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

const { logSend } = vi.hoisted(() => ({ logSend: vi.fn() }));
vi.mock("../../src/repositories", () => ({ emailLogRepo: { logSend } }));

// Keep QUEUE_NAMES real; replace only enqueue.
const { enqueue } = vi.hoisted(() => ({ enqueue: vi.fn() }));
vi.mock("../../src/lib/queue", async (importActual) => {
  const actual = await importActual<typeof import("../../src/lib/queue")>();
  return { ...actual, enqueue };
});

import { sendTemplatedEmail } from "../../src/services/email.service";

describe("email.service.sendTemplatedEmail", () => {
  afterEach(() => vi.clearAllMocks());

  it("records a queued email_logs row then enqueues a send-email job with the log id", async () => {
    logSend.mockResolvedValue({ id: "log_99" });

    const id = await sendTemplatedEmail({
      to: "user@thrivo.fit",
      userId: "user_1",
      template: "notification",
      props: { title: "Hi", body: "There" },
    });

    expect(id).toBe("log_99");
    expect(logSend).toHaveBeenCalledWith({
      userId: "user_1",
      toEmail: "user@thrivo.fit",
      template: "notification",
      status: "queued",
    });

    const [queue, jobName, data] = enqueue.mock.calls[0];
    expect(queue).toBe("emails");
    expect(jobName).toBe("send-email");
    expect(data).toMatchObject({
      emailLogId: "log_99",
      to: "user@thrivo.fit",
      template: "notification",
    });
  });
});

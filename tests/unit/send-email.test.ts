import type { Job } from "bullmq";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the Resend client's sendEmail but keep the real error classes for instanceof.
const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock("../../src/integrations/resend", async (importActual) => {
  const actual = await importActual<typeof import("../../src/integrations/resend")>();
  return { ...actual, sendEmail };
});

const { updateStatus } = vi.hoisted(() => ({ updateStatus: vi.fn() }));
vi.mock("../../src/repositories", () => ({ emailLogRepo: { updateStatus } }));

import { handleSendEmail } from "../../src/jobs/handlers/send-email";
import { EmailNotConfiguredError, EmailSendError } from "../../src/integrations/resend";

function job() {
  return {
    data: {
      emailLogId: "log_1",
      to: "a@b.com",
      template: "notification" as const,
      props: { title: "Hi", body: "There" },
    },
  } as Job;
}

describe("send-email handler", () => {
  afterEach(() => vi.clearAllMocks());

  it("sends and marks the log 'sent' with the provider message id", async () => {
    sendEmail.mockResolvedValue({ id: "msg_42" });

    await handleSendEmail(job());

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [, status, fields] = updateStatus.mock.calls[0];
    expect(status).toBe("sent");
    expect(fields).toEqual({ providerMessageId: "msg_42" });
  });

  it("marks 'failed' and rethrows a transient send error (so BullMQ retries)", async () => {
    sendEmail.mockRejectedValue(new EmailSendError("resend 503", 503));

    await expect(handleSendEmail(job())).rejects.toBeInstanceOf(EmailSendError);
    expect(updateStatus).toHaveBeenCalledWith("log_1", "failed", { error: "resend 503" });
  });

  it("marks 'failed' and does NOT rethrow when email is unconfigured", async () => {
    sendEmail.mockRejectedValue(new EmailNotConfiguredError());

    await expect(handleSendEmail(job())).resolves.toBeUndefined();
    expect(updateStatus.mock.calls[0][1]).toBe("failed");
  });
});

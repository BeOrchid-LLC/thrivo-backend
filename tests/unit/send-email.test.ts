import type { Job } from "bullmq";
import { afterEach, describe, expect, it, vi } from "vitest";

const { transaction } = vi.hoisted(() => ({
  transaction: vi.fn(async (callback: (tx: object) => Promise<unknown>) => callback({})),
}));
vi.mock("../../db", () => ({ db: { transaction } }));

const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock("../../src/integrations/resend", async (importActual) => {
  const actual = await importActual<typeof import("../../src/integrations/resend")>();
  return { ...actual, sendEmail };
});

const {
  findById,
  markAttempt,
  markSent,
  markTerminalFailure,
  updateStatus,
  findByEmailLogId,
  complete,
  findActive,
} = vi.hoisted(() => ({
  findById: vi.fn(),
  markAttempt: vi.fn(),
  markSent: vi.fn(),
  markTerminalFailure: vi.fn(),
  updateStatus: vi.fn(),
  findByEmailLogId: vi.fn(),
  complete: vi.fn(),
  findActive: vi.fn(),
}));
vi.mock("../../src/repositories", () => ({
  emailLogRepo: { findById, markAttempt, markSent, markTerminalFailure, updateStatus },
  emailOutboxRepo: { findByEmailLogId, complete },
  emailSuppressionRepo: { findActive },
}));

const { decryptEmailPayload } = vi.hoisted(() => ({ decryptEmailPayload: vi.fn() }));
vi.mock("../../src/lib/email/outbox-crypto", () => ({ decryptEmailPayload }));

import { handleSendEmail } from "../../src/jobs/handlers/send-email";
import { EmailNotConfiguredError, EmailSendError } from "../../src/integrations/resend";

function job(attemptsMade = 0): Job<{ emailLogId: string }> {
  return {
    id: "log_1",
    data: { emailLogId: "log_1" },
    attemptsMade,
    opts: { attempts: 6 },
  } as Job<{ emailLogId: string }>;
}

function arrangeDurableMessage(status = "queued") {
  findById.mockResolvedValue({
    id: "log_1",
    userId: null,
    toEmail: "a@b.com",
    kind: "legacy_notification",
    status,
  });
  findByEmailLogId.mockResolvedValue({
    emailLogId: "log_1",
    encryptionKeyId: "key-1",
    payloadIv: "iv",
    payloadAuthTag: "tag",
    payloadCiphertext: "ciphertext",
    expiresAt: new Date(Date.now() + 60_000),
  });
  findActive.mockResolvedValue(null);
  decryptEmailPayload.mockReturnValue({
    to: "a@b.com",
    template: "notification",
    props: { title: "Hi", body: "There" },
  });
}

describe("send-email handler", () => {
  afterEach(() => vi.clearAllMocks());

  it("loads the durable payload, sends once, and marks provider acceptance", async () => {
    arrangeDurableMessage();
    sendEmail.mockResolvedValue({ id: "msg_42" });

    await handleSendEmail(job());

    expect(markAttempt).toHaveBeenCalledWith("log_1", "processing");
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "a@b.com",
        idempotencyKey: "thrivo-email/log_1",
      })
    );
    expect(markSent).toHaveBeenCalledWith("log_1", "msg_42", expect.any(Object));
    expect(complete).toHaveBeenCalledWith("log_1", "completed", expect.any(Object));
  });

  it("marks a retryable error as retrying and rethrows for BullMQ", async () => {
    arrangeDurableMessage();
    sendEmail.mockRejectedValue(new EmailSendError("resend 503", 503, true));

    await expect(handleSendEmail(job())).rejects.toBeInstanceOf(EmailSendError);

    expect(updateStatus).toHaveBeenCalledWith("log_1", "retrying", {
      error: "resend 503",
      failureCode: "transient_delivery_error",
    });
    expect(markTerminalFailure).not.toHaveBeenCalled();
  });

  it("recovers provider acceptance without starting another send retry horizon", async () => {
    arrangeDurableMessage();
    sendEmail.mockResolvedValue({ id: "msg_42" });
    transaction.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(handleSendEmail(job(5))).resolves.toBeUndefined();

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(markSent).toHaveBeenCalledWith("log_1", "msg_42", expect.any(Object));
    expect(complete).toHaveBeenCalledWith("log_1", "completed", expect.any(Object));
    expect(updateStatus).not.toHaveBeenCalled();
    expect(markTerminalFailure).not.toHaveBeenCalled();
  });

  it("sanitizes a corrupt payload and marks it terminal without calling the provider", async () => {
    arrangeDurableMessage();
    decryptEmailPayload.mockReturnValueOnce({
      to: "a@b.com",
      template: "notification",
      props: { title: "<secret value>", body: "" },
    });

    await expect(handleSendEmail(job())).resolves.toBeUndefined();

    expect(sendEmail).not.toHaveBeenCalled();
    expect(markTerminalFailure).toHaveBeenCalledWith(
      "log_1",
      "failed",
      "permanent_send_error",
      "Email payload failed validation or rendering",
      expect.any(Object)
    );
  });

  it("marks retry exhaustion terminal, clears the payload, and rethrows", async () => {
    arrangeDurableMessage();
    sendEmail.mockRejectedValue(new EmailSendError("resend 503", 503, true));

    await expect(handleSendEmail(job(5))).rejects.toBeInstanceOf(EmailSendError);

    expect(markTerminalFailure).toHaveBeenCalledWith(
      "log_1",
      "failed",
      "retry_exhausted",
      "resend 503",
      expect.any(Object)
    );
    expect(complete).toHaveBeenCalledWith("log_1", "failed", expect.any(Object));
  });

  it("marks a permanent configuration failure without asking BullMQ to retry", async () => {
    arrangeDurableMessage();
    sendEmail.mockRejectedValue(new EmailNotConfiguredError());

    await expect(handleSendEmail(job())).resolves.toBeUndefined();
    expect(markTerminalFailure).toHaveBeenCalledWith(
      "log_1",
      "failed",
      "provider_not_configured",
      "Email provider is not configured",
      expect.any(Object)
    );
  });

  it("expires stale credentials without decrypting or sending them", async () => {
    arrangeDurableMessage();
    findByEmailLogId.mockResolvedValueOnce({
      emailLogId: "log_1",
      expiresAt: new Date(Date.now() - 1),
    });

    await handleSendEmail(job());

    expect(sendEmail).not.toHaveBeenCalled();
    expect(decryptEmailPayload).not.toHaveBeenCalled();
    expect(markTerminalFailure).toHaveBeenCalledWith(
      "log_1",
      "expired",
      "expired_before_send",
      undefined,
      expect.any(Object)
    );
  });

  it.each(["failed", "expired"])("does not revive a terminal %s message", async (status) => {
    arrangeDurableMessage(status);

    await handleSendEmail(job());

    expect(markAttempt).not.toHaveBeenCalled();
    expect(decryptEmailPayload).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

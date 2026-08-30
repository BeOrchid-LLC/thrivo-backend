import { afterEach, describe, expect, it, vi } from "vitest";

const { transaction } = vi.hoisted(() => ({
  transaction: vi.fn(async (callback: (tx: object) => Promise<unknown>) => callback({})),
}));
vi.mock("../../db", () => ({ db: { transaction } }));

const { findActive, logSendIdempotent, create } = vi.hoisted(() => ({
  findActive: vi.fn(),
  logSendIdempotent: vi.fn(),
  create: vi.fn(),
}));
vi.mock("../../src/repositories", () => ({
  emailSuppressionRepo: { findActive },
  emailLogRepo: { logSendIdempotent },
  emailOutboxRepo: { create },
}));

const { encryptEmailPayload } = vi.hoisted(() => ({ encryptEmailPayload: vi.fn() }));
vi.mock("../../src/lib/email/outbox-crypto", () => ({ encryptEmailPayload }));

import {
  queueTemplatedEmail,
  queueWaitlistConfirmationEmail,
} from "../../src/services/email.service";
import { emailAppLink } from "../../src/lib/email/links";

describe("email.service.queueTemplatedEmail", () => {
  afterEach(() => vi.clearAllMocks());

  it("atomically persists the logical email and encrypted outbox payload without touching Redis", async () => {
    findActive.mockResolvedValue(null);
    logSendIdempotent.mockResolvedValue({ row: { id: "log_99" }, created: true });
    encryptEmailPayload.mockReturnValue({
      keyId: "key-1",
      iv: "iv",
      authTag: "tag",
      ciphertext: "ciphertext",
    });

    const expiresAt = new Date(Date.now() + 60_000);
    const id = await queueTemplatedEmail({
      kind: "welcome",
      to: "USER@thrivo.fit",
      userId: "user_1",
      template: "notification",
      props: {
        title: "Hi",
        body: "There",
        cta: { label: "Open Thrivo", url: emailAppLink("dashboard") },
      },
      dedupeKey: "welcome:user_1",
      expiresAt,
    });

    expect(id).toBe("log_99");
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(logSendIdempotent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        toEmail: "user@thrivo.fit",
        template: "notification",
        kind: "welcome",
        dedupeKey: "welcome:user_1",
        status: "queued",
      }),
      expect.any(Object)
    );
    expect(encryptEmailPayload).toHaveBeenCalledWith(
      {
        to: "user@thrivo.fit",
        template: "notification",
        props: {
          title: "Hi",
          body: "There",
          cta: { label: "Open Thrivo", url: emailAppLink("dashboard") },
        },
      },
      "log_99",
      "welcome"
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        emailLogId: "log_99",
        encryptionKeyId: "key-1",
        payloadCiphertext: "ciphertext",
        expiresAt,
      }),
      expect.any(Object)
    );
  });

  it("returns the existing logical message on a semantic dedupe conflict", async () => {
    findActive.mockResolvedValue(null);
    logSendIdempotent.mockResolvedValue({ row: { id: "existing_log" }, created: false });

    await expect(
      queueTemplatedEmail({
        kind: "welcome",
        to: "user@thrivo.fit",
        template: "notification",
        props: {
          title: "Hi",
          body: "There",
          cta: { label: "Open Thrivo", url: emailAppLink("dashboard") },
        },
        dedupeKey: "welcome:user_1",
        expiresAt: new Date(Date.now() + 60_000),
      })
    ).resolves.toBe("existing_log");

    expect(encryptEmailPayload).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("queues a waitlist confirmation without a welcome CTA", async () => {
    findActive.mockResolvedValue(null);
    logSendIdempotent.mockResolvedValue({ row: { id: "waitlist_log" }, created: true });
    encryptEmailPayload.mockReturnValue({
      keyId: "key-1",
      iv: "iv",
      authTag: "tag",
      ciphertext: "ciphertext",
    });

    await expect(queueWaitlistConfirmationEmail("WAITLIST@thrivo.fit")).resolves.toBe(
      "waitlist_log"
    );

    expect(logSendIdempotent).toHaveBeenCalledWith(
      expect.objectContaining({
        toEmail: "waitlist@thrivo.fit",
        template: "notification",
        kind: "waitlist_confirmation",
        dedupeKey: "waitlist_confirmation:waitlist@thrivo.fit",
        status: "queued",
      }),
      expect.any(Object)
    );
    expect(encryptEmailPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "waitlist@thrivo.fit",
        template: "notification",
        props: {
          title: "You're on the Thrivo waitlist",
          body: expect.any(String),
        },
      }),
      "waitlist_log",
      "waitlist_confirmation"
    );
  });

  it("records a suppressed recipient without retaining an outbox payload", async () => {
    findActive.mockResolvedValue({ reason: "complaint" });
    logSendIdempotent.mockResolvedValue({ row: { id: "suppressed_log" }, created: true });

    await expect(
      queueTemplatedEmail({
        kind: "trial_ending",
        to: "user@thrivo.fit",
        template: "notification",
        props: {
          title: "Trial ending",
          body: "Your trial is ending.",
          cta: { label: "View plans", url: emailAppLink("subscription") },
        },
        expiresAt: new Date(Date.now() + 60_000),
      })
    ).resolves.toBe("suppressed_log");

    expect(logSendIdempotent).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "suppressed",
        failureCode: "suppressed:complaint",
      }),
      expect.any(Object)
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a kind-specific CTA that bypasses the central app-link registry", async () => {
    await expect(
      queueTemplatedEmail({
        kind: "welcome",
        to: "user@thrivo.fit",
        template: "notification",
        props: {
          title: "Hi",
          body: "There",
          cta: { label: "Open Thrivo", url: "https://wrong.example/dashboard" },
        },
        expiresAt: new Date(Date.now() + 60_000),
      })
    ).rejects.toThrow();

    expect(logSendIdempotent).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

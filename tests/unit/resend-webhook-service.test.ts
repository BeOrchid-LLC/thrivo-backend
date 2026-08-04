import { afterEach, describe, expect, it, vi } from "vitest";

const {
  recordReceived,
  findByProviderEvent,
  markProcessed,
  listReceived,
  applyProviderEvent,
  suppress,
} = vi.hoisted(() => ({
  recordReceived: vi.fn(),
  findByProviderEvent: vi.fn(),
  markProcessed: vi.fn(),
  listReceived: vi.fn(),
  applyProviderEvent: vi.fn(),
  suppress: vi.fn(),
}));
vi.mock("../../src/repositories", () => ({
  webhookEventRepo: { recordReceived, findByProviderEvent, markProcessed, listReceived },
  emailLogRepo: { applyProviderEvent },
  emailSuppressionRepo: { suppress },
}));

import { handleResendWebhook } from "../../src/services/resend-webhook.service";

function ledger(payload: object) {
  return {
    id: "ledger_1",
    provider: "resend",
    eventId: "svix_1",
    payload,
    status: "received",
    receivedAt: new Date("2024-01-21T10:00:00Z"),
  };
}

describe("resend webhook processing", () => {
  afterEach(() => vi.clearAllMocks());

  it("keeps an event pending when it arrives before provider id persistence", async () => {
    const payload = {
      type: "email.delivered",
      created_at: "2024-01-21T09:59:00.000Z",
      data: { email_id: "provider_1", to: ["person@example.com"] },
    };
    recordReceived.mockResolvedValue(ledger(payload));
    applyProviderEvent.mockResolvedValue(null);

    await expect(handleResendWebhook("svix_1", payload)).resolves.toBe("pending");
    expect(markProcessed).not.toHaveBeenCalled();
  });

  it("suppresses future sends after a complaint and marks the ledger processed", async () => {
    const payload = {
      type: "email.complained",
      data: { email_id: "provider_1", to: "Person@Example.com" },
    };
    recordReceived.mockResolvedValue(ledger(payload));
    applyProviderEvent.mockResolvedValue({ id: "log_1" });

    await expect(handleResendWebhook("svix_1", payload)).resolves.toBe("processed");

    expect(applyProviderEvent).toHaveBeenCalledWith(
      "provider_1",
      "complained",
      new Date("2024-01-21T10:00:00Z")
    );
    expect(suppress).toHaveBeenCalledWith("Person@Example.com", "complained", "svix_1");
    expect(markProcessed).toHaveBeenCalledWith("ledger_1", "processed");
  });

  it("treats a previously processed Svix id as an idempotent duplicate", async () => {
    recordReceived.mockResolvedValue(null);
    findByProviderEvent.mockResolvedValue({ status: "processed" });

    await expect(
      handleResendWebhook("svix_1", {
        type: "email.sent",
        data: { email_id: "provider_1" },
      })
    ).resolves.toBe("duplicate");

    expect(applyProviderEvent).not.toHaveBeenCalled();
  });
});

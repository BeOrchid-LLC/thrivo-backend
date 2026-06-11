import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mutable mocked env so each test can flip RESEND_API_KEY.
const state = vi.hoisted(() => ({
  env: { RESEND_API_KEY: "re_test_key" as string | undefined, EMAIL_FROM: "Thrivo <noreply@thrivo.fit>" },
}));
vi.mock("../../src/env", () => ({ env: state.env }));

import { sendEmail, EmailNotConfiguredError, EmailSendError } from "../../src/integrations/resend";

const okResponse = (id: string) =>
  ({ ok: true, status: 200, json: async () => ({ id }), text: async () => "" }) as unknown as Response;
const errResponse = (status: number) =>
  ({ ok: false, status, json: async () => ({}), text: async () => "boom" }) as unknown as Response;

const input = { to: "a@b.com", subject: "Hi", html: "<p>hi</p>" };

describe("resend client", () => {
  beforeEach(() => {
    state.env.RESEND_API_KEY = "re_test_key";
    // Zero out jitter so retry backoff doesn't actually wait.
    vi.spyOn(Math, "random").mockReturnValue(0);
  });
  afterEach(() => vi.restoreAllMocks());

  it("posts to Resend and returns the message id on success", async () => {
    const fetchMock = vi.fn(async () => okResponse("msg_123"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendEmail(input);

    expect(result).toEqual({ id: "msg_123" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("api.resend.com");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer re_test_key");
  });

  it("throws EmailNotConfiguredError and never calls fetch when the key is missing", async () => {
    state.env.RESEND_API_KEY = undefined;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendEmail(input)).rejects.toBeInstanceOf(EmailNotConfiguredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not retry a 4xx (bad payload won't heal)", async () => {
    const fetchMock = vi.fn(async () => errResponse(422));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendEmail(input)).rejects.toBeInstanceOf(EmailSendError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 5xx then gives up with EmailSendError", async () => {
    const fetchMock = vi.fn(async () => errResponse(503));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendEmail(input)).rejects.toBeInstanceOf(EmailSendError);
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it("normalizes a network failure to a retryable EmailSendError", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendEmail(input)).rejects.toBeInstanceOf(EmailSendError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

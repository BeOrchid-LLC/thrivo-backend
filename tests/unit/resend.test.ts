import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  env: {
    RESEND_API_KEY: "re_test_key" as string | undefined,
    EMAIL_FROM: "Thrivo <noreply@thrivo.fit>",
  },
}));
vi.mock("../../src/env", () => ({ env: state.env }));

import {
  sendEmail,
  EmailNotConfiguredError,
  EmailSendError,
  isRetryableEmailError,
} from "../../src/integrations/resend";

const okResponse = (id: string) =>
  ({ ok: true, status: 200, json: async () => ({ id }) }) as unknown as Response;
const errResponse = (status: number) =>
  ({ ok: false, status, json: async () => ({}) }) as unknown as Response;

const input = {
  to: "a@b.com",
  subject: "Hi",
  html: "<p>hi</p>",
  idempotencyKey: "thrivo-email/log_1",
};

describe("resend client", () => {
  beforeEach(() => {
    state.env.RESEND_API_KEY = "re_test_key";
  });
  afterEach(() => vi.restoreAllMocks());

  it("posts once with the stable idempotency key and returns the provider message id", async () => {
    const fetchMock = vi.fn(async () => okResponse("msg_123"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendEmail(input)).resolves.toEqual({ id: "msg_123" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("api.resend.com");
    expect(init.headers).toMatchObject({
      authorization: "Bearer re_test_key",
      "idempotency-key": "thrivo-email/log_1",
    });
  });

  it("throws EmailNotConfiguredError and never calls fetch when the key is missing", async () => {
    state.env.RESEND_API_KEY = undefined;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendEmail(input)).rejects.toBeInstanceOf(EmailNotConfiguredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("classifies permanent 4xx responses as non-retryable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errResponse(422))
    );

    const error = await sendEmail(input).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EmailSendError);
    expect(isRetryableEmailError(error)).toBe(false);
  });

  it("does not perform nested retries and classifies 5xx responses as retryable", async () => {
    const fetchMock = vi.fn(async () => errResponse(503));
    vi.stubGlobal("fetch", fetchMock);

    const error = await sendEmail(input).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EmailSendError);
    expect(isRetryableEmailError(error)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("normalizes one network failure to a retryable EmailSendError", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    vi.stubGlobal("fetch", fetchMock);

    const error = await sendEmail(input).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EmailSendError);
    expect(isRetryableEmailError(error)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

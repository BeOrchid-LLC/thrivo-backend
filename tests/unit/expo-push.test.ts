import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chunk,
  collectInvalidTokens,
  sendExpoPushBatch,
  type ExpoPushMessage,
} from "../../src/integrations/expo-push";

describe("expo-push chunk", () => {
  it("splits into batches of the given size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("returns no batches for empty input", () => {
    expect(chunk([], 100)).toEqual([]);
  });
});

describe("expo-push invalid-token detection", () => {
  const messages: ExpoPushMessage[] = [
    { to: "tok-a", title: "t", body: "b" },
    { to: "tok-b", title: "t", body: "b" },
  ];

  it("flags DeviceNotRegistered tokens index-aligned with the batch", () => {
    const tickets = [
      { status: "ok" as const },
      { status: "error" as const, details: { error: "DeviceNotRegistered" } },
    ];
    expect(collectInvalidTokens(messages, tickets)).toEqual(["tok-b"]);
  });

  it("ignores transient errors that are not a dead token", () => {
    const tickets = [
      { status: "error" as const, details: { error: "MessageRateExceeded" } },
      { status: "ok" as const },
    ];
    expect(collectInvalidTokens(messages, tickets)).toEqual([]);
  });
});

describe("sendExpoPushBatch (R5-3 / I15)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts the batch and returns invalid tokens from the response", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ status: "ok" }, { status: "error", details: { error: "DeviceNotRegistered" } }],
      }),
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendExpoPushBatch([
      { to: "tok-a", title: "t", body: "b" },
      { to: "tok-b", title: "t", body: "b" },
    ]);

    expect(result).toEqual({ invalidTokens: ["tok-b"] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("throws on a non-2xx response (caller's retry policy applies)", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendExpoPushBatch([{ to: "tok-a", title: "t", body: "b" }])).rejects.toThrow(
      "status 500"
    );
  });

  it("aborts and throws when the request hangs past the timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })
    ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const pending = sendExpoPushBatch([{ to: "tok-a", title: "t", body: "b" }]);
    const assertion = expect(pending).rejects.toThrow("Expo push request failed");
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    vi.useRealTimers();
  });
});

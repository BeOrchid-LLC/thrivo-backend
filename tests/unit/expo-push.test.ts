import { describe, expect, it } from "vitest";
import {
  chunk,
  collectInvalidTokens,
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

import { describe, expect, it } from "vitest";
import { encodeCursor, decodeCursor, clampLimit } from "../../src/lib/pagination";
import { ValidationError } from "../../src/lib/errors";

describe("pagination", () => {
  it("round-trips a cursor key", () => {
    const key = { loggedAt: "2026-06-10T00:00:00Z", id: "abc" };
    expect(decodeCursor(encodeCursor(key))).toEqual(key);
  });

  it("produces a url-safe (base64url) cursor", () => {
    const cursor = encodeCursor({ q: "a/b+c=d ?" });
    expect(cursor).not.toMatch(/[/+=]/);
  });

  it("throws a ValidationError on a malformed cursor", () => {
    expect(() => decodeCursor("!!!not-base64-json!!!")).toThrow(ValidationError);
  });

  it("clamps the page size into range", () => {
    expect(clampLimit(undefined)).toBe(20);
    expect(clampLimit(5)).toBe(5);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(9999)).toBe(100);
    expect(clampLimit(Number.NaN)).toBe(20);
  });
});

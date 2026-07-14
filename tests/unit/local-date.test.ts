import { describe, expect, it } from "vitest";
import {
  isValidTimezone,
  localDateFor,
  localHourFor,
  shiftLocalDate,
} from "../../src/lib/local-date";

describe("local-date", () => {
  it("validates real IANA zone names and rejects garbage", () => {
    expect(isValidTimezone("Africa/Lagos")).toBe(true);
    expect(isValidTimezone("America/New_York")).toBe(true);
    expect(isValidTimezone("not-a-real-zone")).toBe(false);
  });

  it("computes the local date in a given timezone", () => {
    // 2024-01-15T02:00:00Z is still 2024-01-14 in New York (UTC-5).
    const at = new Date("2024-01-15T02:00:00Z");
    expect(localDateFor("America/New_York", at)).toBe("2024-01-14");
    expect(localDateFor("UTC", at)).toBe("2024-01-15");
  });

  it("falls back to UTC for a missing or invalid timezone", () => {
    const at = new Date("2024-01-15T02:00:00Z");
    expect(localDateFor(null, at)).toBe("2024-01-15");
    expect(localDateFor("not-a-real-zone", at)).toBe("2024-01-15");
  });

  it("computes the local hour in a given timezone", () => {
    const at = new Date("2024-01-15T13:00:00Z");
    expect(localHourFor("UTC", at)).toBe(13);
    // Lagos is UTC+1.
    expect(localHourFor("Africa/Lagos", at)).toBe(14);
  });

  it("shifts a local date string by whole days without drifting across a month boundary", () => {
    expect(shiftLocalDate("2024-03-01", -1)).toBe("2024-02-29"); // leap year
    expect(shiftLocalDate("2024-01-15", 7)).toBe("2024-01-22");
    expect(shiftLocalDate("2024-01-15", -7)).toBe("2024-01-08");
  });
});

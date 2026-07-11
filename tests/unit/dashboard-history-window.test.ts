import { describe, expect, it } from "vitest";
import { resolveHistoryWindow } from "../../src/services/dashboard.service";

describe("resolveHistoryWindow (I3 / ADR-0022 D3)", () => {
  it("uses the explicit `today` over server-UTC when the client is behind UTC (UTC-7, 18:00 local)", () => {
    // Server UTC has already rolled to 2026-06-16 01:00Z; the UTC-7 client's
    // wall-clock local day is still 2026-06-15.
    const serverNow = new Date("2026-06-16T01:00:00.000Z");
    const window = resolveHistoryWindow({ today: "2026-06-15" }, serverNow);

    expect(window.today).toBe("2026-06-15");
    // 7-day window: today - 6 days.
    expect(window.lockBefore).toBe("2026-06-09");
  });

  it("uses the explicit `today` over server-UTC when the client is ahead of UTC (UTC+13)", () => {
    // Server UTC is still 2026-06-14T23:00Z; the UTC+13 client's local day has
    // already rolled to 2026-06-15.
    const serverNow = new Date("2026-06-14T23:00:00.000Z");
    const window = resolveHistoryWindow({ today: "2026-06-15" }, serverNow);

    expect(window.today).toBe("2026-06-15");
    expect(window.lockBefore).toBe("2026-06-09");
  });

  it("falls back to `to` when `today` is omitted (legacy client)", () => {
    const window = resolveHistoryWindow({ to: "2026-06-15" }, new Date("2026-06-16T01:00:00.000Z"));
    expect(window.today).toBe("2026-06-15");
  });

  it("falls back to server-UTC when neither `today` nor `to` is sent", () => {
    const window = resolveHistoryWindow({}, new Date("2026-06-16T01:00:00.000Z"));
    expect(window.today).toBe("2026-06-16");
  });

  it("holds across a DST-adjacent date (US spring-forward, 2026-03-08)", () => {
    const window = resolveHistoryWindow(
      { today: "2026-03-08" },
      new Date("2026-03-08T09:00:00.000Z") // 01:00 PST — still "yesterday" in UTC terms if mishandled
    );
    expect(window.today).toBe("2026-03-08");
    expect(window.lockBefore).toBe("2026-03-02");
  });

  it("holds across a month/year boundary", () => {
    const window = resolveHistoryWindow(
      { today: "2027-01-02" },
      new Date("2027-01-02T12:00:00.000Z")
    );
    expect(window.lockBefore).toBe("2026-12-27");
  });

  it("defaults `from` to 29 days before `to` when omitted", () => {
    const window = resolveHistoryWindow({ today: "2026-06-15" });
    expect(window.to).toBe("2026-06-15");
    expect(window.from).toBe("2026-05-17");
  });
});

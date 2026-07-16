import { describe, expect, it } from "vitest";
import { buildHydrationAlert } from "../../src/services/dashboard.service";

describe("buildHydrationAlert", () => {
  it("does not nudge during sleeping hours", () => {
    expect(buildHydrationAlert(0, 2000, 4)).toBeNull();
  });

  it("does not nudge when the user is close to the expected pace", () => {
    expect(buildHydrationAlert(1100, 2000, 17)).toBeNull();
  });

  it("nudges when the user is meaningfully behind the active-day pace", () => {
    expect(buildHydrationAlert(980, 2000, 17)).toEqual({
      title: "Drink up",
      message: "It's 5 PM and you've only hit 49% of your daily goal. Try to reach 75% by 8 PM.",
      severity: "warning",
    });
  });
});

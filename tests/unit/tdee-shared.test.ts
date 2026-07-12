import { describe, expect, it } from "vitest";
import { bmrMifflinStJeor, calculateTdee } from "../../contracts/src/tdee";
import { calculateTargets } from "../../src/services/tdee.service";

describe("contracts/tdee (R6 I19 — single shared implementation)", () => {
  it("rounds only the final TDEE, never the intermediate BMR", () => {
    // weightKg=68, heightCm=169, ageYears=28, male → raw BMR = 1601.25 (fractional).
    // Rounding BMR to 1601 *before* multiplying by the activity factor (the old
    // mobile bug) gives 2201; rounding only the product (the correct order,
    // matching the backend) gives 2202. This input exists specifically to
    // catch a regression to double-rounding.
    const input = {
      goal: "maintain" as const,
      sex: "male" as const,
      weightKg: 68,
      heightCm: 169,
      ageYears: 28,
      activityLevel: "light" as const,
    };

    const rawBmr = bmrMifflinStJeor(input);
    expect(rawBmr).toBeCloseTo(1601.25, 5);

    const doubleRounded = Math.round(Math.round(rawBmr) * 1.375);
    expect(doubleRounded).toBe(2201); // the bug this phase fixes

    const result = calculateTdee(input);
    expect(result.tdeeKcal).toBe(2202); // the correct, single-rounded value
  });

  it("backend's calculateTargets uses the same shared formula (identical tdeeKcal for the same input)", () => {
    const input = {
      goal: "maintain" as const,
      sex: "male" as const,
      weightKg: 68,
      heightCm: 169,
      ageYears: 28,
      activityLevel: "light" as const,
    };

    expect(calculateTdee(input).tdeeKcal).toBe(calculateTargets(input).tdeeKcal);
  });
});

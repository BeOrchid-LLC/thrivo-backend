import { describe, expect, it } from "vitest";
import { calculateTargets } from "../../src/services/tdee.service";

describe("tdee.service", () => {
  it("uses averaged BMR coefficients for prefer_not_to_say", () => {
    const targets = calculateTargets({
      goal: "maintain",
      sex: "prefer_not_to_say",
      weightKg: 70,
      heightCm: 170,
      ageYears: 30,
      activityLevel: "sedentary",
    });

    expect(targets.tdeeKcal).toBe(1841);
    expect(targets.dailyTargetKcal).toBe(1840);
    expect(targets.targetProteinG).toBe(138);
    expect(targets.targetCarbsG).toBe(184);
    expect(targets.targetFatG).toBe(61);
  });

  it("honors a manual daily calorie target while still deriving macros", () => {
    const targets = calculateTargets({
      goal: "lose",
      sex: "female",
      weightKg: 72,
      heightCm: 168,
      ageYears: 32,
      manualDailyTargetKcal: 1500,
    });

    expect(targets.dailyTargetKcal).toBe(1500);
    expect(targets.targetProteinG).toBe(113);
  });
});

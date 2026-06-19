import type { Goal, Sex } from "../../db/schema";

export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";

export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

const GOAL_ADJUSTMENTS: Record<Goal, number> = {
  lose: -500,
  maintain: 0,
  gain: 300,
};

export type TdeeInput = {
  goal: Goal;
  sex: Sex;
  weightKg: number;
  heightCm: number;
  ageYears: number;
  activityLevel?: ActivityLevel | null;
  manualDailyTargetKcal?: number | null;
};

export type TdeeTargets = {
  tdeeKcal: number;
  dailyTargetKcal: number;
  targetProteinG: number;
  targetCarbsG: number;
  targetFatG: number;
};

const round10 = (n: number) => Math.round(n / 10) * 10;

function bmrMifflinStJeor(
  input: Omit<TdeeInput, "goal" | "activityLevel" | "manualDailyTargetKcal">
) {
  const base = 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.ageYears;
  if (input.sex === "male") return base + 5;
  if (input.sex === "female") return base - 161;
  return (base + 5 + base - 161) / 2;
}

export function deriveMacroTargets(kcal: number) {
  return {
    targetProteinG: Math.round((kcal * 0.3) / 4),
    targetCarbsG: Math.round((kcal * 0.4) / 4),
    targetFatG: Math.round((kcal * 0.3) / 9),
  };
}

export function calculateTargets(input: TdeeInput): TdeeTargets {
  const activityLevel = input.activityLevel ?? "sedentary";
  const bmr = bmrMifflinStJeor(input);
  const tdeeKcal = Math.round(bmr * ACTIVITY_FACTORS[activityLevel]);
  const dailyTargetKcal =
    input.manualDailyTargetKcal ?? round10(tdeeKcal + GOAL_ADJUSTMENTS[input.goal]);

  return {
    tdeeKcal,
    dailyTargetKcal,
    ...deriveMacroTargets(dailyTargetKcal),
  };
}

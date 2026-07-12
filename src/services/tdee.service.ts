import type { Goal, Sex } from "../../db/schema";
import {
  ACTIVITY_FACTORS,
  calculateTdee,
  macroSplitFromKcal,
  type ActivityLevel,
} from "../../contracts/src/tdee";

export type { ActivityLevel };
export { ACTIVITY_FACTORS };

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

/** Backend's DB-column naming for the shared 30/40/30 macro split (R6 I19). */
export function deriveMacroTargets(kcal: number) {
  const { proteinG, carbsG, fatG } = macroSplitFromKcal(kcal);
  return { targetProteinG: proteinG, targetCarbsG: carbsG, targetFatG: fatG };
}

export function calculateTargets(input: TdeeInput): TdeeTargets {
  const { tdeeKcal, dailyTargetKcal } = calculateTdee(input);
  const finalDailyTarget = input.manualDailyTargetKcal ?? dailyTargetKcal;

  return {
    tdeeKcal,
    dailyTargetKcal: finalDailyTarget,
    ...deriveMacroTargets(finalDailyTarget),
  };
}

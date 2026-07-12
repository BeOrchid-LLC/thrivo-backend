import type { z } from "zod";
import { activityLevelSchema, goalSchema, sexSchema } from "./users";

/**
 * Single source of truth for calorie/macro math (Mifflin-St Jeor + activity
 * factor + goal adjustment + macro split). Backend and mobile each had their
 * own copy that rounded BMR at a different point (backend: round only the
 * final TDEE; mobile: round BMR before multiplying by the activity factor),
 * so onboarding's preview could disagree with the persisted dashboard target
 * by several kcal at some inputs (R6 I19). This module keeps the backend's
 * order — round only the final TDEE, never the intermediate BMR.
 */

export type Goal = z.infer<typeof goalSchema>;
export type Sex = z.infer<typeof sexSchema>;
export type ActivityLevel = z.infer<typeof activityLevelSchema>;

/** Standard Mifflin-St Jeor activity multipliers. */
export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

/** Daily kcal delta for the goal: ~0.5 kg/week deficit for loss, surplus for gain. */
export const GOAL_ADJUSTMENTS: Record<Goal, number> = {
  lose: -500,
  maintain: 0,
  gain: 300,
};

export interface BmrInput {
  sex: Sex;
  weightKg: number;
  heightCm: number;
  ageYears: number;
}

/**
 * Mifflin-St Jeor basal metabolic rate (kcal/day). Deliberately left
 * unrounded — callers round only the final TDEE (see `calculateTdee`), never
 * this intermediate value.
 */
export function bmrMifflinStJeor({ sex, weightKg, heightCm, ageYears }: BmrInput): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  if (sex === "male") return base + 5;
  if (sex === "female") return base - 161;
  return base - 78;
}

export const round10 = (n: number): number => Math.round(n / 10) * 10;

export interface TdeeInput extends BmrInput {
  goal: Goal;
  activityLevel?: ActivityLevel | null;
}

export interface TdeeResult {
  /** Rounded for display only — the multiply below uses the unrounded BMR. */
  bmr: number;
  activityLevel: ActivityLevel;
  tdeeKcal: number;
  goalAdjustmentKcal: number;
  /** TDEE + goal adjustment, rounded to the nearest 10 kcal. */
  dailyTargetKcal: number;
}

export function calculateTdee(input: TdeeInput): TdeeResult {
  const activityLevel = input.activityLevel ?? "sedentary";
  const rawBmr = bmrMifflinStJeor(input);
  const tdeeKcal = Math.round(rawBmr * ACTIVITY_FACTORS[activityLevel]);
  const goalAdjustmentKcal = GOAL_ADJUSTMENTS[input.goal];
  return {
    bmr: Math.round(rawBmr),
    activityLevel,
    tdeeKcal,
    goalAdjustmentKcal,
    dailyTargetKcal: round10(tdeeKcal + goalAdjustmentKcal),
  };
}

export interface MacroSplit {
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/** Balanced 30% protein / 40% carbs / 30% fat split (4/4/9 kcal per gram). */
export function macroSplitFromKcal(kcal: number): MacroSplit {
  return {
    proteinG: Math.round((kcal * 0.3) / 4),
    carbsG: Math.round((kcal * 0.4) / 4),
    fatG: Math.round((kcal * 0.3) / 9),
  };
}

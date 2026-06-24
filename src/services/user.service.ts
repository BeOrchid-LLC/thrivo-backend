import type { NewUserRow, UserTier } from "../../db/schema";
import type { UpdateProfilePayload } from "../../contracts/src/users";
import { userRepo } from "../repositories";
import type { User } from "../repositories/user.repository";
import { NotFoundError } from "../lib/errors";
import { calculateTargets, deriveMacroTargets, type ActivityLevel } from "./tdee.service";

export type AccountStatus = "dormant" | "free_trial" | "free_plan" | "paid";

const TRIAL_DAYS = 7;
const START_TRIAL_ONBOARDING_STEP = 6;
const COMPLETE_ONBOARDING_STEP = 7;

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function decimal(n: number): string {
  return n.toFixed(1);
}

function numberFromDb(value: string | null): number | null {
  return value === null ? null : Number.parseFloat(value);
}

function timeWithSeconds(value: string): string {
  return value.length === 5 ? `${value}:00` : value;
}

export function effectiveAccountStatus(user: User, now = new Date()): AccountStatus {
  if (user.tier === ("premium" satisfies UserTier)) return "paid";
  const status = (user.accountStatus ?? "dormant") as AccountStatus;
  if (status === "free_trial" && user.trialEndsAt && user.trialEndsAt <= now) {
    return "free_plan";
  }
  return status;
}

export function isUserOnboarded(user: User): boolean {
  return user.onboardingStep >= COMPLETE_ONBOARDING_STEP;
}

export function isUserOnboardingSkipped(user: User): boolean {
  return user.onboardingSkipped === true;
}

function firstNameOnly(value: string): string {
  return value.trim().split(/\s+/)[0] ?? value.trim();
}

function buildTargetPatch(user: User, patch: Partial<NewUserRow>): Partial<NewUserRow> {
  const goal = patch.goal ?? user.goal;
  const sex = patch.sex ?? user.sex;
  const age = patch.age ?? user.age;
  const heightCm = numberFromDb((patch.heightCm ?? user.heightCm) as string | null);
  const weightKg = numberFromDb((patch.weightKg ?? user.weightKg) as string | null);
  const activityLevel = (patch.activityLevel ?? user.activityLevel) as ActivityLevel | null;
  const manualDailyTargetKcal = patch.manualDailyTargetKcal ?? user.manualDailyTargetKcal;

  if (manualDailyTargetKcal) {
    return {
      dailyTargetKcal: manualDailyTargetKcal,
      ...deriveMacroTargets(manualDailyTargetKcal),
    };
  }

  if (!goal || !sex || !age || heightCm === null || weightKg === null) return {};

  return calculateTargets({
    goal,
    sex,
    ageYears: age,
    heightCm,
    weightKg,
    activityLevel,
  });
}

export async function updateUserProfile(
  user: User,
  input: UpdateProfilePayload,
  now = new Date()
): Promise<User> {
  const patch: Partial<NewUserRow> = {};

  if (input.firstName !== undefined) patch.name = firstNameOnly(input.firstName);
  if (input.goal !== undefined) patch.goal = input.goal;
  if (input.sex !== undefined) patch.sex = input.sex;
  if (input.ageYears !== undefined) patch.age = input.ageYears;
  if (input.heightCm !== undefined) patch.heightCm = decimal(input.heightCm);
  if (input.currentWeightKg !== undefined) patch.weightKg = decimal(input.currentWeightKg);
  if (input.targetWeightKg !== undefined) patch.targetWeightKg = decimal(input.targetWeightKg);
  if (input.activityLevel !== undefined) patch.activityLevel = input.activityLevel;
  if (input.manualDailyTargetKcal !== undefined) {
    patch.manualDailyTargetKcal = input.manualDailyTargetKcal;
  }
  if (input.notifyTimes !== undefined) patch.notifyTimes = input.notifyTimes.map(timeWithSeconds);
  if (input.timezone !== undefined) patch.timezone = input.timezone;
  if (input.onboardingStep !== undefined) patch.onboardingStep = input.onboardingStep;

  Object.assign(patch, buildTargetPatch(user, patch));

  if (input.activationIntent === "start_free_trial") {
    patch.onboardingStep = Math.max(
      input.onboardingStep ?? user.onboardingStep,
      START_TRIAL_ONBOARDING_STEP
    );
    const currentStatus = effectiveAccountStatus(user, now);
    // Only start a trial if user is on free plan (or legacy dormant) and hasn't had one before.
    if ((currentStatus === "free_plan" || currentStatus === "dormant") && !user.trialEndsAt) {
      patch.accountStatus = "free_trial";
      patch.trialEndsAt = addDays(now, TRIAL_DAYS);
    }
  } else if (input.activationIntent === "complete") {
    patch.onboardingStep = Math.max(
      input.onboardingStep ?? user.onboardingStep,
      COMPLETE_ONBOARDING_STEP
    );
  } else if (input.activationIntent === "skip") {
    patch.onboardingSkipped = true;
    if (input.onboardingStep !== undefined) {
      patch.onboardingStep = Math.max(input.onboardingStep, user.onboardingStep);
    }
  } else if (
    effectiveAccountStatus(user, now) === "free_plan" &&
    user.accountStatus !== "free_plan"
  ) {
    // Sync expired-trial users whose accountStatus wasn't written yet (edge case).
    patch.accountStatus = "free_plan";
  }

  const updated = await userRepo.updateProfile(user.id, patch);
  if (!updated) throw new NotFoundError("User not found");
  return updated;
}

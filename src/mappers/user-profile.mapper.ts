import { userProfileSchema, type UserProfile } from "../../contracts/src/users";
import {
  effectiveAccountStatus,
  isUserOnboarded,
  isUserOnboardingSkipped,
} from "../services/user.service";
import type { User } from "../repositories/user.repository";

/** Self-service + admin profile DTO — never leaks authSubjectId or soft-delete bookkeeping. */
export function toUserProfile(u: User): UserProfile {
  return userProfileSchema.parse({
    id: u.id,
    email: u.email,
    name: u.name,
    image: u.image,
    goal: u.goal,
    sex: u.sex,
    age: u.age,
    heightCm: u.heightCm,
    weightKg: u.weightKg,
    targetWeightKg: u.targetWeightKg,
    tdeeKcal: u.tdeeKcal,
    dailyTargetKcal: u.dailyTargetKcal,
    targetProteinG: u.targetProteinG,
    targetCarbsG: u.targetCarbsG,
    targetFatG: u.targetFatG,
    activityLevel: u.activityLevel,
    manualDailyTargetKcal: u.manualDailyTargetKcal,
    notifyTimes: u.notifyTimes,
    timezone: u.timezone,
    tier: u.tier,
    accountStatus: effectiveAccountStatus(u),
    trialEndsAt: u.trialEndsAt,
    onboardingStep: u.onboardingStep,
    isOnboarded: isUserOnboarded(u),
    isOnboardingSkipped: isUserOnboardingSkipped(u),
    createdAt: u.createdAt,
  });
}

import type { Context } from "hono";
import {
  updateProfilePayloadSchema,
  userProfileSchema,
  type UserProfile,
} from "../../contracts/src/users";
import { ok } from "../lib/response";
import { userRepo } from "../repositories";
import {
  effectiveAccountStatus,
  isUserOnboarded,
  updateUserProfile,
} from "../services/user.service";
import type { AppEnv } from "../types/http";
import type { User } from "../repositories/user.repository";

// Public profile DTO — never leaks the auth link or soft-delete bookkeeping.
function toProfile(u: User): UserProfile {
  return userProfileSchema.parse({
    id: u.id,
    email: u.email,
    name: u.name,
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
    notifyAt: u.notifyAt,
    timezone: u.timezone,
    tier: u.tier,
    accountStatus: effectiveAccountStatus(u),
    trialEndsAt: u.trialEndsAt,
    onboardingStep: u.onboardingStep,
    isOnboarded: isUserOnboarded(u),
    createdAt: u.createdAt,
  });
}

/** GET /users/me — the caller's own profile. `requireAuth` guarantees the user. */
export function getMe(c: Context<AppEnv>) {
  const user = c.get("user")!;
  return c.json(ok(toProfile(user)));
}

/** PATCH /users/me/profile — persist onboarding/profile draft fields and targets. */
export async function updateMeProfile(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const validJson = c.req.valid as (target: "json") => unknown;
  const input = updateProfilePayloadSchema.parse(validJson("json"));
  const updated = await updateUserProfile(user, input);
  return c.json(ok(toProfile(updated)));
}

/** DELETE /users/me — GDPR soft delete of the caller's own account. */
export async function deleteMe(c: Context<AppEnv>) {
  const user = c.get("user")!;
  await userRepo.softDeleteUser(user.id);
  return c.body(null, 204);
}

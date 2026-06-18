import type { Context } from "hono";
import { userProfileSchema, type UserProfile } from "../../contracts/src/users";
import { ok } from "../lib/response";
import { userRepo } from "../repositories";
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
    notifyAt: u.notifyAt,
    timezone: u.timezone,
    tier: u.tier,
    onboardingStep: u.onboardingStep,
    createdAt: u.createdAt,
  });
}

/** GET /users/me — the caller's own profile. `requireAuth` guarantees the user. */
export function getMe(c: Context<AppEnv>) {
  const user = c.get("user")!;
  return c.json(ok(toProfile(user)));
}

/** DELETE /users/me — GDPR soft delete of the caller's own account. */
export async function deleteMe(c: Context<AppEnv>) {
  const user = c.get("user")!;
  await userRepo.softDeleteUser(user.id);
  return c.body(null, 204);
}

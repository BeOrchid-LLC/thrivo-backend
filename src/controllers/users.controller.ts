import type { Context } from "hono";
import { updateProfilePayloadSchema } from "../../contracts/src/users";
import { respondOk } from "../lib/response";
import { toUserProfile } from "../mappers/user-profile.mapper";
import { userRepo } from "../repositories";
import { updateUserProfile } from "../services/user.service";
import type { AppEnv } from "../types/http";

/** GET /users/me — the caller's own profile. `requireAuth` guarantees the user. */
export function getMe(c: Context<AppEnv>) {
  const user = c.get("user")!;
  return respondOk(c, toUserProfile(user));
}

/** PATCH /users/me/profile — persist onboarding/profile draft fields and targets. */
export async function updateMeProfile(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const validJson = c.req.valid as (target: "json") => unknown;
  const input = updateProfilePayloadSchema.parse(validJson("json"));
  const updated = await updateUserProfile(user, input);
  return respondOk(c, toUserProfile(updated));
}

/** DELETE /users/me — GDPR soft delete of the caller's own account. */
export async function deleteMe(c: Context<AppEnv>) {
  const user = c.get("user")!;
  await userRepo.softDeleteUser(user.id);
  return respondOk(c, null, "Account deleted");
}

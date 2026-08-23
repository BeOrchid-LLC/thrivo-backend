import type { Context } from "hono";
import { updateProfilePayloadSchema } from "../../contracts/src/users";
import { updateUserSettingsPayloadSchema } from "../../contracts/src/settings";
import { respondOk } from "../lib/response";
import { toUserProfile } from "../mappers/user-profile.mapper";
import { getValidatedInput } from "../middleware/validate";
import { updateUserProfile } from "../services/user.service";
import { requestAccountErasure } from "../services/account-erasure.service";
import { UnauthorizedError } from "../lib/errors";
import { getUserSettings, updateUserSettings } from "../services/settings.service";
import type { AppEnv } from "../types/http";

/** GET /users/me — the caller's own profile. `requireAuth` guarantees the user. */
export function getMe(c: Context<AppEnv>) {
  const user = c.get("user")!;
  return respondOk(c, toUserProfile(user));
}

/** PATCH /users/me/profile — persist onboarding/profile draft fields and targets. */
export async function updateMeProfile(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const input = updateProfilePayloadSchema.parse(getValidatedInput(c, "json"));
  const updated = await updateUserProfile(user, input);
  return respondOk(c, toUserProfile(updated));
}

/** GET /users/me/settings — synced app settings for the current user. */
export async function getMySettings(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const settings = await getUserSettings(user.id);
  return respondOk(c, settings);
}

/** PATCH /users/me/settings — persist synced app settings for the current user. */
export async function updateMySettings(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const input = updateUserSettingsPayloadSchema.parse(getValidatedInput(c, "json"));
  const settings = await updateUserSettings(user.id, input);
  return respondOk(c, settings);
}

/** DELETE /users/me — GDPR soft delete of the caller's own account. */
export async function deleteMe(c: Context<AppEnv>) {
  const principal = c.get("principal");
  const user = c.get("user");
  if (!principal) throw new UnauthorizedError("Authentication required");
  if (!user) return respondOk(c, null, "Account deletion is already queued", 202);
  await requestAccountErasure(user.id, principal.subjectId, user.email);
  return respondOk(c, null, "Account deletion is queued", 202);
}

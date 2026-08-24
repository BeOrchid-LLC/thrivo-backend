import type { Context } from "hono";
import { registerPushPayload } from "../../contracts/src/push";
import { respondOk } from "../lib/response";
import { getValidatedInput } from "../middleware/validate";
import { pushTokenRepo } from "../repositories";
import type { AppEnv } from "../types/http";

/** POST /push/register — register or refresh the caller's Expo device token. */
export async function registerPush(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const input = registerPushPayload.parse(getValidatedInput(c, "json"));
  await pushTokenRepo.register({
    userId: user.id,
    expoPushToken: input.expoPushToken,
    platform: input.platform,
  });
  return respondOk(c, null, "Push token registered");
}

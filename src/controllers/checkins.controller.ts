import type { Context } from "hono";
import { createCheckinPayload } from "../../contracts/src/checkins";
import { respondOk } from "../lib/response";
import { getValidatedInput } from "../middleware/validate";
import { createCheckin, listCheckins } from "../services/checkin.service";
import type { AppEnv } from "../types/http";

export async function postCheckin(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const input = createCheckinPayload.parse(getValidatedInput(c, "json"));
  const result = await createCheckin(user, input);
  return respondOk(c, result, "Check-in saved", 201);
}

export async function getCheckins(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const result = await listCheckins(user);
  return respondOk(c, result);
}

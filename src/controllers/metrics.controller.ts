import type { Context } from "hono";
import {
  addWaterPayloadSchema,
  deleteWaterParamsSchema,
  waterQuerySchema,
} from "../../contracts/src/metrics";
import { NotFoundError } from "../lib/errors";
import { respondOk } from "../lib/response";
import { getValidatedInput } from "../middleware/validate";
import { waterIntakeRepo } from "../repositories";
import { invalidateWaterDashboardCache } from "../services/dashboard-cache.service";
import { getWaterState } from "../services/dashboard.service";
import type { AppEnv } from "../types/http";

export async function getWater(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const { date } = waterQuerySchema.parse(getValidatedInput(c, "query"));
  const water = await getWaterState(user, date);
  return respondOk(c, { water });
}

export async function addWater(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const input = addWaterPayloadSchema.parse(getValidatedInput(c, "json"));
  await waterIntakeRepo.addEntry({
    userId: user.id,
    localDate: input.day,
    amountMl: input.amountMl,
    recordedAt: new Date(),
  });
  await invalidateWaterDashboardCache(user.id, input.day);
  const water = await getWaterState(user, input.day);
  return respondOk(c, { water });
}

export async function deleteWater(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const { id } = deleteWaterParamsSchema.parse(getValidatedInput(c, "param"));
  const deleted = await waterIntakeRepo.deleteEntryForUser(user.id, id);
  if (!deleted) throw new NotFoundError("Water entry not found");
  await invalidateWaterDashboardCache(user.id, deleted.localDate);
  const water = await getWaterState(user, deleted.localDate);
  return respondOk(c, { water });
}

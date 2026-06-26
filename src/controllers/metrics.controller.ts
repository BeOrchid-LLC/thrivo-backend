import type { Context } from "hono";
import { addWaterPayloadSchema, waterQuerySchema } from "../../contracts/src/metrics";
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

import type { Context } from "hono";
import {
  addWeightPayloadSchema,
  addWaterPayloadSchema,
  chartQuerySchema,
  deleteWeightParamsSchema,
  deleteWaterParamsSchema,
  progressQuerySchema,
  updateWaterParamsSchema,
  updateWaterPayloadSchema,
  waterQuerySchema,
  weightQuerySchema,
} from "../../contracts/src/metrics";
import { readIdempotencyKey } from "../lib/idempotency";
import { NotFoundError } from "../lib/errors";
import { respondOk } from "../lib/response";
import { getValidatedInput } from "../middleware/validate";
import { waterIntakeRepo } from "../repositories";
import { invalidateWaterDashboardCache } from "../services/dashboard-cache.service";
import { getWaterState } from "../services/dashboard.service";
import {
  deleteWeight as deleteWeightEntry,
  getMetricChart,
  getProgress as getProgressState,
  getWeightContext as getWeightContextState,
  saveWater,
  saveWeight,
} from "../services/metrics.service";
import type { AppEnv } from "../types/http";

export async function getProgress(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const { date } = progressQuerySchema.parse(getValidatedInput(c, "query"));
  const progress = await getProgressState(user, date);
  return respondOk(c, { progress });
}

export async function getChart(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const { date, metric, period } = chartQuerySchema.parse(getValidatedInput(c, "query"));
  const chart = await getMetricChart(user, metric, period, date);
  return respondOk(c, { chart });
}

export async function getWeightContext(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const { date } = weightQuerySchema.parse(getValidatedInput(c, "query"));
  const context = await getWeightContextState(user, date);
  return respondOk(c, { context });
}

export async function addWeight(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const input = addWeightPayloadSchema.parse(getValidatedInput(c, "json"));
  const entry = await saveWeight(user, input.day, input.weightKg);
  return respondOk(c, { entry });
}

export async function deleteWeight(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const { id } = deleteWeightParamsSchema.parse(getValidatedInput(c, "param"));
  await deleteWeightEntry(user, id);
  return respondOk(c, { ok: true });
}

export async function getWater(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const { date } = waterQuerySchema.parse(getValidatedInput(c, "query"));
  const water = await getWaterState(user, date);
  return respondOk(c, { water });
}

export async function addWater(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const input = addWaterPayloadSchema.parse(getValidatedInput(c, "json"));
  await saveWater(user, input.day, input.amountMl, readIdempotencyKey(c));
  const water = await getWaterState(user, input.day);
  return respondOk(c, { water });
}

export async function updateWater(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const { id } = updateWaterParamsSchema.parse(getValidatedInput(c, "param"));
  const input = updateWaterPayloadSchema.parse(getValidatedInput(c, "json"));
  const updated = await waterIntakeRepo.updateEntryForUser(user.id, id, {
    amountMl: input.amountMl,
    recordedAt: input.recordedAt ? new Date(input.recordedAt) : undefined,
  });
  if (!updated) throw new NotFoundError("Water entry not found");
  await invalidateWaterDashboardCache(user.id, updated.localDate);
  const water = await getWaterState(user, updated.localDate);
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

import type { Context } from "hono";
import { dashboardDateQuerySchema } from "../../contracts/src/dashboard";
import { respondOk } from "../lib/response";
import { getValidatedInput } from "../middleware/validate";
import {
  getDashboardCalories,
  getDashboardMacros,
  getDashboardStreak,
} from "../services/dashboard.service";
import type { AppEnv } from "../types/http";

export async function getCalories(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const { date } = dashboardDateQuerySchema.parse(getValidatedInput(c, "query"));
  const calories = await getDashboardCalories(user, date);
  return respondOk(c, { calories });
}

export async function getMacros(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const { date } = dashboardDateQuerySchema.parse(getValidatedInput(c, "query"));
  const macros = await getDashboardMacros(user, date);
  return respondOk(c, { macros });
}

export async function getStreak(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const streak = await getDashboardStreak(user);
  return respondOk(c, { streak });
}

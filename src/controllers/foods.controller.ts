import type { Context } from "hono";
import { foodLogDayQuerySchema, foodLogHistoryQuerySchema } from "../../contracts/src/foods";
import { respondOk } from "../lib/response";
import { getHistoryDays, getMealGroupsForDay } from "../services/dashboard.service";
import type { AppEnv } from "../types/http";

export async function getFoodLogDay(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const validQuery = c.req.valid as (target: "query") => unknown;
  const { date } = foodLogDayQuerySchema.parse(validQuery("query"));
  const groups = await getMealGroupsForDay(user, date);
  return respondOk(c, { day: date, groups, isEmptyDay: groups.length === 0 });
}

export async function getFoodLogHistory(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const validQuery = c.req.valid as (target: "query") => unknown;
  const query = foodLogHistoryQuerySchema.parse(validQuery("query"));
  const history = await getHistoryDays(user, query);
  return respondOk(c, history);
}

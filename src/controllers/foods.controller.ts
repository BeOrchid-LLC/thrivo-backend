import type { Context } from "hono";
import { foodLogDayQuerySchema, foodLogHistoryQuerySchema } from "../../contracts/src/foods";
import { respondOk } from "../lib/response";
import { getValidatedInput } from "../middleware/validate";
import { getFoodEntriesForDay, getHistoryDays } from "../services/dashboard.service";
import type { AppEnv } from "../types/http";

export async function getFoodLogDay(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const { date } = foodLogDayQuerySchema.parse(getValidatedInput(c, "query"));
  const entries = await getFoodEntriesForDay(user, date);
  return respondOk(c, { day: date, entries, isEmptyDay: entries.length === 0 });
}

export async function getFoodLogHistory(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const query = foodLogHistoryQuerySchema.parse(getValidatedInput(c, "query"));
  const history = await getHistoryDays(user, query);
  return respondOk(c, history);
}

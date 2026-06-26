import { Hono } from "hono";
import { foodLogDayQuerySchema, foodLogHistoryQuerySchema } from "../../contracts/src/foods";
import { getFoodLogDay, getFoodLogHistory } from "../controllers/foods.controller";
import { requireAuth } from "../middleware/require-auth";
import { validate } from "../middleware/validate";
import type { AppEnv } from "../types/http";

export const foodsRouter = new Hono<AppEnv>();

foodsRouter.use(requireAuth);
foodsRouter.get("/log/day", validate("query", foodLogDayQuerySchema), getFoodLogDay);
foodsRouter.get("/log/history", validate("query", foodLogHistoryQuerySchema), getFoodLogHistory);

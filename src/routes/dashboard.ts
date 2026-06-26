import { Hono } from "hono";
import { dashboardDateQuerySchema } from "../../contracts/src/dashboard";
import { getCalories, getMacros, getStreak } from "../controllers/dashboard.controller";
import { requireAuth } from "../middleware/require-auth";
import { validate } from "../middleware/validate";
import type { AppEnv } from "../types/http";

export const dashboardRouter = new Hono<AppEnv>();

dashboardRouter.use(requireAuth);
dashboardRouter.get("/calories", validate("query", dashboardDateQuerySchema), getCalories);
dashboardRouter.get("/macros", validate("query", dashboardDateQuerySchema), getMacros);
dashboardRouter.get("/streak", getStreak);

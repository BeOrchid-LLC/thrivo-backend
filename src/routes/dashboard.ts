import { Hono } from "hono";
import { dashboardDateQuerySchema } from "../../contracts/src/dashboard";
import { getCalories, getMacros, getStreak } from "../controllers/dashboard.controller";
import { requireAuth } from "../middleware/require-auth";
import { requirePremium } from "../middleware/require-premium";
import { validate } from "../middleware/validate";
import type { AppEnv } from "../types/http";

export const dashboardRouter = new Hono<AppEnv>();

dashboardRouter.use(requireAuth);
dashboardRouter.get("/calories", validate("query", dashboardDateQuerySchema), getCalories);
dashboardRouter.get(
  "/macros",
  requirePremium,
  validate("query", dashboardDateQuerySchema),
  getMacros
);
dashboardRouter.get("/streak", getStreak);

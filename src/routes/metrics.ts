import { Hono } from "hono";
import {
  addWaterPayloadSchema,
  deleteWaterParamsSchema,
  waterQuerySchema,
} from "../../contracts/src/metrics";
import { addWater, deleteWater, getWater } from "../controllers/metrics.controller";
import { requireAuth } from "../middleware/require-auth";
import { requirePremium } from "../middleware/require-premium";
import { validate } from "../middleware/validate";
import type { AppEnv } from "../types/http";

export const metricsRouter = new Hono<AppEnv>();

metricsRouter.use(requireAuth);
metricsRouter.use(requirePremium);
metricsRouter.get("/water", validate("query", waterQuerySchema), getWater);
metricsRouter.post("/water", validate("json", addWaterPayloadSchema), addWater);
metricsRouter.delete("/water/:id", validate("param", deleteWaterParamsSchema), deleteWater);

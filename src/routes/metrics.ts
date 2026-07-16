import { Hono } from "hono";
import {
  addWeightPayloadSchema,
  addWaterPayloadSchema,
  chartQuerySchema,
  deleteWeightParamsSchema,
  deleteWaterParamsSchema,
  progressQuerySchema,
  updateWaterParamsSchema,
  updateWaterPayloadSchema,
  waterHistoryQuerySchema,
  waterQuerySchema,
  weightQuerySchema,
} from "../../contracts/src/metrics";
import {
  addWater,
  addWeight,
  deleteWater,
  deleteWeight,
  getChart,
  getProgress,
  getWater,
  getWaterHistory,
  getWeightContext,
  updateWater,
} from "../controllers/metrics.controller";
import { requireAuth } from "../middleware/require-auth";
import { validate } from "../middleware/validate";
import type { AppEnv } from "../types/http";

export const metricsRouter = new Hono<AppEnv>();

metricsRouter.use(requireAuth);
metricsRouter.get("/progress", validate("query", progressQuerySchema), getProgress);
metricsRouter.get("/chart", validate("query", chartQuerySchema), getChart);
metricsRouter.get("/weight/context", validate("query", weightQuerySchema), getWeightContext);
metricsRouter.post("/weight", validate("json", addWeightPayloadSchema), addWeight);
metricsRouter.delete("/weight/:id", validate("param", deleteWeightParamsSchema), deleteWeight);
metricsRouter.get("/water/history", validate("query", waterHistoryQuerySchema), getWaterHistory);
metricsRouter.get("/water", validate("query", waterQuerySchema), getWater);
metricsRouter.post("/water", validate("json", addWaterPayloadSchema), addWater);
metricsRouter.patch(
  "/water/:id",
  validate("param", updateWaterParamsSchema),
  validate("json", updateWaterPayloadSchema),
  updateWater
);
metricsRouter.delete("/water/:id", validate("param", deleteWaterParamsSchema), deleteWater);

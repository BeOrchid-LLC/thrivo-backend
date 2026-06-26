import { Hono } from "hono";
import { addWaterPayloadSchema, waterQuerySchema } from "../../contracts/src/metrics";
import { addWater, getWater } from "../controllers/metrics.controller";
import { requireAuth } from "../middleware/require-auth";
import { validate } from "../middleware/validate";
import type { AppEnv } from "../types/http";

export const metricsRouter = new Hono<AppEnv>();

metricsRouter.use(requireAuth);
metricsRouter.get("/water", validate("query", waterQuerySchema), getWater);
metricsRouter.post("/water", validate("json", addWaterPayloadSchema), addWater);

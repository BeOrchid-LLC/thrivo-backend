import { Hono } from "hono";
import { validate } from "../middleware/validate";
import { leadCapturePayloadSchema } from "../../contracts/src/leads";
import { postCaptureLead } from "../controllers/leads.controller";
import { leadsRateLimit } from "../middleware/rate-limit";
import type { AppEnv } from "../types/http";

/** `/api/v1/leads` — public, unauthenticated email-capture surface. */
export const leadsRouter = new Hono<AppEnv>();

leadsRouter.post(
  "/capture",
  leadsRateLimit,
  validate("json", leadCapturePayloadSchema),
  postCaptureLead
);

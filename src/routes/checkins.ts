import { Hono } from "hono";
import { createCheckinPayload } from "../../contracts/src/checkins";
import { getCheckins, postCheckin } from "../controllers/checkins.controller";
import { requireAuth } from "../middleware/require-auth";
import { requirePremium } from "../middleware/require-premium";
import { validate } from "../middleware/validate";
import type { AppEnv } from "../types/http";

/** Mood check-ins (premium). One per day; returns the day's psychology tip. */
export const checkinsRouter = new Hono<AppEnv>();

checkinsRouter.use(requireAuth);
checkinsRouter.post("/", requirePremium, validate("json", createCheckinPayload), postCheckin);
checkinsRouter.get("/", requirePremium, getCheckins);

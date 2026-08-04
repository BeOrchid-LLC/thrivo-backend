import { Hono } from "hono";
import {
  getWeeklyReviewEmailPreference,
  postDisableWeeklyReviewEmail,
  postOneClickWeeklyReviewUnsubscribe,
} from "../controllers/email-preferences.controller";
import { emailPreferenceRateLimit } from "../middleware/rate-limit";
import type { AppEnv } from "../types/http";

export const emailPreferencesRouter = new Hono<AppEnv>();

emailPreferencesRouter.use("/*", emailPreferenceRateLimit);
emailPreferencesRouter.get("/weekly-review", getWeeklyReviewEmailPreference);
emailPreferencesRouter.post("/weekly-review", postDisableWeeklyReviewEmail);
emailPreferencesRouter.post("/weekly-review/one-click", postOneClickWeeklyReviewUnsubscribe);

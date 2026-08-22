import { Hono } from "hono";
import {
  cancelSubscriptionPayloadSchema,
  purchaseSubscriptionPayloadSchema,
  startTrialPayloadSchema,
} from "../../contracts/src/subscriptions";
import {
  getMySubscription,
  postCancelSubscription,
  postPurchaseSubscription,
  postStartTrial,
  postSyncSubscription,
} from "../controllers/subscriptions.controller";
import { requireAuth } from "../middleware/require-auth";
import { validate } from "../middleware/validate";
import type { AppEnv } from "../types/http";
import { rateLimit } from "../middleware/rate-limit";

export const subscriptionsRouter = new Hono<AppEnv>();

subscriptionsRouter.use(requireAuth);
subscriptionsRouter.get("/me", getMySubscription);
subscriptionsRouter.post(
  "/sync",
  rateLimit({ windowSec: 60, max: 10, keyPrefix: "subscription-sync" }),
  postSyncSubscription
);
subscriptionsRouter.post("/trial", validate("json", startTrialPayloadSchema), postStartTrial);
subscriptionsRouter.post(
  "/purchase",
  validate("json", purchaseSubscriptionPayloadSchema),
  postPurchaseSubscription
);
subscriptionsRouter.post(
  "/cancel",
  validate("json", cancelSubscriptionPayloadSchema),
  postCancelSubscription
);

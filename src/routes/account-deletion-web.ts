import { Hono } from "hono";
import {
  accountDeletionConfirmationPayloadSchema,
  accountDeletionRequestPayloadSchema,
} from "../../contracts/src/account-deletion";
import {
  confirmAccountDeletion,
  requestAccountDeletion,
} from "../controllers/account-deletion-web.controller";
import { validate } from "../middleware/validate";
import { rateLimit } from "../middleware/rate-limit";
import type { AppEnv } from "../types/http";

export const accountDeletionWebRouter = new Hono<AppEnv>();

accountDeletionWebRouter.use("/*", async (c, next) => {
  c.header("Cache-Control", "no-store, max-age=0");
  c.header("Pragma", "no-cache");
  await next();
});

accountDeletionWebRouter.post(
  "/",
  rateLimit({ windowSec: 15 * 60, max: 5, keyPrefix: "account-deletion-ip" }),
  validate("json", accountDeletionRequestPayloadSchema),
  requestAccountDeletion
);

accountDeletionWebRouter.post(
  "/confirm",
  rateLimit({ windowSec: 15 * 60, max: 10, keyPrefix: "account-deletion-confirm-ip" }),
  validate("json", accountDeletionConfirmationPayloadSchema),
  confirmAccountDeletion
);

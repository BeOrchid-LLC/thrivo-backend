import { Hono } from "hono";
import { registerPushPayload } from "../../contracts/src/push";
import { registerPush } from "../controllers/push.controller";
import { requireAuth } from "../middleware/require-auth";
import { validate } from "../middleware/validate";
import type { AppEnv } from "../types/http";

export const pushRouter = new Hono<AppEnv>();

pushRouter.use(requireAuth);
pushRouter.post("/register", validate("json", registerPushPayload), registerPush);

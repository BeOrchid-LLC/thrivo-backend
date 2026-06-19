import { Hono } from "hono";
import { requireAuth } from "../middleware/require-auth";
import { getMe, updateMeProfile, deleteMe } from "../controllers/users.controller";
import { updateProfilePayloadSchema } from "../../contracts/src/users";
import { validate } from "../middleware/validate";
import type { AppEnv } from "../types/http";

/** `/api/v1/users` — the reference protected router (auth → controller → repo). */
export const usersRouter = new Hono<AppEnv>();

usersRouter.use(requireAuth);
usersRouter.get("/me", getMe);
usersRouter.patch("/me/profile", validate("json", updateProfilePayloadSchema), updateMeProfile);
usersRouter.delete("/me", deleteMe);

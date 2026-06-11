import { Hono } from "hono";
import { requireAuth } from "../middleware/require-auth";
import { getMe, deleteMe } from "../controllers/users.controller";
import type { AppEnv } from "../types/http";

/** `/api/v1/users` — the reference protected router (auth → controller → repo). */
export const usersRouter = new Hono<AppEnv>();

usersRouter.use(requireAuth);
usersRouter.get("/me", getMe);
usersRouter.delete("/me", deleteMe);

import { Hono } from "hono";
import { requireAuth } from "../middleware/require-auth";
import {
  getMe,
  updateMeProfile,
  deleteMe,
  getMySettings,
  updateMySettings,
} from "../controllers/users.controller";
import { updateProfilePayloadSchema } from "../../contracts/src/users";
import { updateUserSettingsPayloadSchema } from "../../contracts/src/settings";
import { validate } from "../middleware/validate";
import type { AppEnv } from "../types/http";
import { requireRecentVerification } from "../middleware/reverification";

/** `/api/v1/users` — the reference protected router (auth → controller → repo). */
export const usersRouter = new Hono<AppEnv>();

// DELETE is intentionally registered before the normal auth gate so an
// already-accepted deletion can be retried idempotently after a lost response.
usersRouter.delete("/me", requireRecentVerification, deleteMe);
usersRouter.use(requireAuth);
usersRouter.get("/me", getMe);
usersRouter.patch("/me/profile", validate("json", updateProfilePayloadSchema), updateMeProfile);
usersRouter.get("/me/settings", getMySettings);
usersRouter.patch(
  "/me/settings",
  validate("json", updateUserSettingsPayloadSchema),
  updateMySettings
);

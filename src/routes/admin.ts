import { Hono } from "hono";
import { requireAdmin } from "../middleware/require-admin";
import {
  postAdminRequestOtp,
  postAdminVerifyOtp,
  getAdminSession,
  postAdminLogout,
} from "../controllers/admin-auth.controller";
import {
  listAdminUsers,
  getAdminUser,
  hardDeleteAdminUser,
} from "../controllers/admin-users.controller";
import type { AppEnv } from "../types/http";

/** `/api/v1/admin` — staff-only surface gated by the admin session cookie. */
export const adminRouter = new Hono<AppEnv>();

// Auth (public — no cookie required to log in)
adminRouter.post("/auth/request-otp", postAdminRequestOtp);
adminRouter.post("/auth/verify-otp", postAdminVerifyOtp);

// Auth (protected — requires a valid admin session cookie)
adminRouter.get("/auth/session", requireAdmin, getAdminSession);
adminRouter.post("/auth/logout", requireAdmin, postAdminLogout);

// User management (all protected)
adminRouter.get("/users", requireAdmin, listAdminUsers);
adminRouter.get("/users/:id", requireAdmin, getAdminUser);
adminRouter.delete("/users/:id", requireAdmin, hardDeleteAdminUser);

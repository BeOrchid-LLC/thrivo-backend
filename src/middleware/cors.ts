import { cors } from "hono/cors";
import { env } from "../env";

/**
 * CORS for the first-party browsers (web + admin). Origins come from
 * `env.CORS_ORIGINS`; credentials are allowed so cookie sessions work. Native
 * mobile sends no Origin and is unaffected.
 */
export const corsMiddleware = cors({
  origin: env.CORS_ORIGINS,
  credentials: true,
  allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
});

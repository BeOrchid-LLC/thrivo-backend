import { pino } from "pino";
import { env } from "../env";

/** Process-wide structured logger. Request-scoped child loggers (with correlation
 *  ids via pino-http) are layered on in the middleware pipeline (A1-3/A1-6). */
export const logger = pino({ level: env.LOG_LEVEL });

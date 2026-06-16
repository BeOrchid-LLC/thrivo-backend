import { pino, type LoggerOptions } from "pino";
import { env } from "../env";

/**
 * Process-wide structured logger. Request-scoped child loggers (bound with the
 * correlation id) are created by the logging middleware via `logger.child`.
 *
 * - JSON in `test`/`production` (cheap, shipper-friendly, no transport worker);
 *   pretty, colorized output only in `development`.
 * - `redact` strips credentials/secrets so they never reach logs or Sentry
 *   breadcrumbs — see the Security section in BACKEND_ARCHITECTURE §9.
 */
const options: LoggerOptions = {
  level: env.LOG_LEVEL,
  // base: null drops the per-line pid/hostname/service noise. Re-add a
  // `base: { service: "thrivo-backend" }` here if logs are later shipped to a
  // shared aggregator where distinguishing the source matters.
  base: null,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.password",
      "*.token",
      "*.secret",
      "*.authorization",
    ],
    censor: "[redacted]",
  },
};

export const logger =
  env.NODE_ENV === "development"
    ? pino({
        ...options,
        transport: { target: "pino-pretty", options: { translateTime: "SYS:standard" } },
      })
    : pino({
        ...options,
        // The JSON lines read directly in Coolify: ISO-8601 timestamps and
        // string level names ("info" instead of 30). pino-pretty already does
        // both in development.
        timestamp: pino.stdTimeFunctions.isoTime,
        formatters: { level: (label) => ({ level: label }) },
      });

import type { Logger } from "pino";
import type { User } from "../repositories/user.repository";

/**
 * Typed Hono context for the app. Declared on Hono's `Variables` generic so
 * middleware and handlers read `c.var.*` type-safe.
 */
export type AppEnv = {
  Variables: {
    /** Correlation id for the request — minted or carried from the edge. */
    requestId: string;
    /** Child logger bound to `requestId`; set by the logging middleware. */
    logger: Logger;
    /** Resolved domain user when authenticated; undefined for anonymous requests. */
    user?: User;
  };
};

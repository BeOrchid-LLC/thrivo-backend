/**
 * Typed Hono context for the app. Declared on Hono's `Variables` generic so
 * middleware and handlers read `c.var.*` type-safe. Extended per concern:
 * `requestId` (request-id middleware) lands here; `logger` (request-scoped pino)
 * is added with the logging middleware.
 */
export type AppEnv = {
  Variables: {
    /** Correlation id for the request — minted or carried from the edge. */
    requestId: string;
  };
};

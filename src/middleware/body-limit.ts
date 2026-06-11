import { bodyLimit } from "hono/body-limit";

/**
 * Reject oversized request bodies early (→ 413) before they reach a handler.
 * 100 KB is generous for this JSON API; bump per-route later if a specific
 * endpoint needs it. The error uses the standard `{ error }` shape.
 */
export const bodyLimitMiddleware = bodyLimit({
  maxSize: 100 * 1024,
  onError: (c) =>
    c.json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Request body too large" } }, 413),
});

import { bodyLimit } from "hono/body-limit";
import { PayloadTooLargeError } from "../lib/errors";

/**
 * Reject oversized request bodies early (→ 413) before they reach a handler.
 * 100 KB is generous for this JSON API; bump per-route later if a specific
 * endpoint needs it. Throwing (rather than returning a Response) routes the
 * body through the central errorHandler so it matches the one contract
 * envelope instead of hand-rolling a second shape.
 */
export const bodyLimitMiddleware = bodyLimit({
  maxSize: 100 * 1024,
  onError: () => {
    throw new PayloadTooLargeError();
  },
});

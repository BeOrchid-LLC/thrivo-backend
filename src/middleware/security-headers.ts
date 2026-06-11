import { secureHeaders } from "hono/secure-headers";

/**
 * Security response headers (helmet-equivalent). Defaults suit a JSON API:
 * `X-Content-Type-Options: nosniff`, frame-deny, strict referrer, HSTS. No CSP —
 * the API serves no HTML, and TLS terminates at Cloudflare in front of us.
 */
export const securityHeaders = secureHeaders();

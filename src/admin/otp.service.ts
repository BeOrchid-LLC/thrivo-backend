import { createOtp, type OtpConsumeResult } from "../lib/otp";

export type { OtpConsumeResult };

// Same hardened primitive as the user flow — hashed codes, atomic consume, and
// the 30s → 5m → 1h → 24h lockout ladder. Previously this path stored plaintext
// codes and had a GET/INCR TOCTOU; consolidating removed both. The per-email
// issue throttle mirrors auth/otp.service.ts (5 / 15 min) — it's the
// load-bearing guard: this endpoint is public on api.thrivo.fit, and an
// unthrottled issue both emails a human and consumes shared Resend quota,
// which can take down user-facing sign-in email as collateral (I6).
export const ADMIN_OTP_TTL_SEC = 300;

const adminOtp = createOtp({
  namespace: "admin-otp",
  ttlSec: ADMIN_OTP_TTL_SEC,
  throttle: { max: 5, windowSec: 15 * 60 },
});

export type AdminRole = "super-admin" | "admin" | "support" | "read-only";

/**
 * Generate and persist a 6-digit OTP for an admin email. Returns null when the
 * per-email issue throttle is exceeded — caller stays silent (no enumeration),
 * same contract as the user flow's issueAuthOtp.
 */
export async function issueAdminOtp(email: string): Promise<string | null> {
  return adminOtp.issue(email.toLowerCase());
}

/** Verify and atomically consume the OTP, applying backoff/lockout on misses. */
export async function consumeAdminOtp(email: string, code: string): Promise<OtpConsumeResult> {
  return adminOtp.consume(email.toLowerCase(), code);
}

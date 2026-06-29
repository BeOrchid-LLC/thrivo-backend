import { createOtp, type OtpConsumeResult } from "../lib/otp";
import { env } from "../env";

export type { OtpConsumeResult };

// Same hardened primitive as the user flow — hashed codes, atomic consume, and
// the 30s → 5m → 1h → 24h lockout ladder. Previously this path stored plaintext
// codes and had a GET/INCR TOCTOU; consolidating removed both.
const adminOtp = createOtp({ namespace: "admin-otp", ttlSec: 300 });

/** Returns true if the email is in the configured admin allowlist. */
export function isAllowedAdminEmail(email: string): boolean {
  return env.ADMIN_EMAILS.includes(email.toLowerCase());
}

/** Generate and persist a 6-digit OTP for an admin email. Returns the code. */
export async function issueAdminOtp(email: string): Promise<string> {
  const code = await adminOtp.issue(email.toLowerCase());
  // No issue throttle is configured for admin, so a code is always returned.
  if (!code) throw new Error("admin OTP issuance unexpectedly throttled");
  return code;
}

/** Verify and atomically consume the OTP, applying backoff/lockout on misses. */
export async function consumeAdminOtp(email: string, code: string): Promise<OtpConsumeResult> {
  return adminOtp.consume(email.toLowerCase(), code);
}

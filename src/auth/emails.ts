import { sendTemplatedEmail } from "../services/email.service";
import type { OtpProps } from "../lib/email/templates/otp";

// Map the OTP flow's `type` to our template purpose. Every auth email then
// flows through the standard pipeline (queue → Resend → email_logs).
const PURPOSE: Record<string, OtpProps["purpose"]> = {
  "sign-in": "sign-in",
  "email-verification": "email-verification",
  "forget-password": "password-reset",
};

export async function sendAuthOtp(
  email: string,
  otp: string,
  type: string,
  ttlSec: number
): Promise<void> {
  await sendTemplatedEmail({
    to: email,
    template: "otp",
    props: {
      code: otp,
      purpose: PURPOSE[type] ?? "sign-in",
      expiresInMinutes: Math.max(1, Math.round(ttlSec / 60)),
    },
  });
}

export async function sendAuthMagicLink(
  email: string,
  ctaUrl: string,
  ttlMin: number
): Promise<void> {
  await sendTemplatedEmail({
    to: email,
    template: "magic-link",
    props: { url: ctaUrl, expiresInMinutes: ttlMin },
  });
}

/**
 * Sent exactly once, right after a brand-new `users` row is created (A5-5).
 * Callers pass `userId` so the send is tied to the new account in `email_logs`.
 */
export async function sendWelcomeEmail(email: string, userId: string): Promise<void> {
  await sendTemplatedEmail({
    to: email,
    userId,
    template: "notification",
    props: {
      title: "Welcome to Thrivo",
      body: "Your account is ready. Log your first meal to see your daily calories in seconds — no hidden pricing, cancel anytime in two taps.",
      cta: { label: "Open Thrivo", url: "https://thrivo.fit/app" },
    },
  });
}

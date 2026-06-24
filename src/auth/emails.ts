import { sendTemplatedEmail } from "../services/email.service";
import type { OtpProps } from "../lib/email/templates/otp";

// Map BetterAuth's OTP `type` to our template purpose. Every auth email then
// flows through the standard pipeline (queue → Resend → email_logs).
const PURPOSE: Record<string, OtpProps["purpose"]> = {
  "sign-in": "sign-in",
  "email-verification": "email-verification",
  "forget-password": "password-reset",
};

export async function sendAuthOtp(email: string, otp: string, type: string): Promise<void> {
  await sendTemplatedEmail({
    to: email,
    template: "otp",
    props: { code: otp, purpose: PURPOSE[type] ?? "sign-in" },
  });
}

export async function sendAuthMagicLink(email: string, ctaUrl: string): Promise<void> {
  await sendTemplatedEmail({
    to: email,
    template: "notification",
    props: {
      title: "Sign in to Thrivo",
      body: "Use this secure link to continue. It expires in 15 minutes.",
      cta: { label: "Continue to Thrivo", url: ctaUrl },
    },
  });
}

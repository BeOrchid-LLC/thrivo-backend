import type { EmailTemplate } from "../types";
import { baseLayout, escapeHtml } from "./base";

/** One-time code email — reused for sign-in, email verification, and reset. */
export type OtpProps = {
  code: string;
  /** What the code is for, so the copy can adapt. */
  purpose: "sign-in" | "email-verification" | "password-reset";
};

const HEADINGS: Record<OtpProps["purpose"], string> = {
  "sign-in": "Your Thrivo sign-in code",
  "email-verification": "Verify your email",
  "password-reset": "Reset your password",
};

export const otpTemplate: EmailTemplate<OtpProps> = {
  subject: (p) => `${HEADINGS[p.purpose]}: ${p.code}`,
  render: (p) => {
    const heading = HEADINGS[p.purpose];
    const contentHtml = `<h1 style="margin:0 0 12px;font-size:20px;">${escapeHtml(heading)}</h1>
      <p style="margin:0 0 16px;">Enter this code to continue. It expires in 10 minutes.</p>
      <p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:0;">${escapeHtml(p.code)}</p>
      <p style="margin:16px 0 0;color:#71717a;font-size:13px;">If you didn't request this, you can ignore this email.</p>`;
    const text = `${heading}\n\nYour code: ${p.code}\nIt expires in 10 minutes. If you didn't request this, ignore this email.`;
    return { html: baseLayout({ contentHtml }), text };
  },
};

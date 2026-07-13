import type { EmailTemplate } from "../types";
import {
  emailDivider,
  emailFooter,
  emailHeader,
  emailHeroText,
  emailIconBadge,
  emailRowList,
  emailShell,
  escapeHtml,
} from "./base";
import { emailTokens } from "../tokens";

/** One-time code email — reused for sign-in, email verification, and reset. */
export type OtpProps = {
  code: string;
  /** What the code is for, so the copy can adapt. */
  purpose: "sign-in" | "email-verification" | "password-reset";
  /** How long the code is valid for, so the copy stays accurate if the TTL changes. */
  expiresInMinutes: number;
};

const HEADINGS: Record<OtpProps["purpose"], string> = {
  "sign-in": "Your Thrivo sign-in code",
  "email-verification": "Verify your email",
  "password-reset": "Reset your password",
};

const PARAGRAPHS: Record<OtpProps["purpose"], string> = {
  "sign-in": "Enter this code to sign in to Thrivo.",
  "email-verification":
    "Enter this code in Thrivo to confirm your email address and activate your account.",
  "password-reset": "Enter this code in Thrivo to confirm your identity and reset your password.",
};

const CLOSING_NOTES: Record<OtpProps["purpose"], string> = {
  "sign-in": "Didn't request this code? Ignore the email — your account stays secure.",
  "email-verification":
    "Didn't create a Thrivo account? Ignore the email — nothing has been activated.",
  "password-reset":
    "Didn't request a password reset? Ignore the email — your password stays unchanged.",
};

/** Renders the code as individual boxed digits (Figma 277:492 — a `Container` per character). */
function otpCodeBoxes(code: string): string {
  const boxes = code
    .split("")
    .map(
      (char) =>
        `<td class="email-input" style="width:44px;height:56px;background:${emailTokens.light.inputBg};border:1.5px solid ${emailTokens.light.border};border-radius:10px;" align="center" valign="middle">
          <span class="email-heading" style="font-size:28px;font-weight:600;letter-spacing:-0.5px;">${escapeHtml(char)}</span>
        </td>`
    )
    .join(`<td style="width:8px;">&nbsp;</td>`);

  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>${boxes}</tr></table>`;
}

export const otpTemplate: EmailTemplate<OtpProps> = {
  subject: (p) => `${HEADINGS[p.purpose]}: ${p.code}`,
  render: (p, ctx) => {
    const heading = HEADINGS[p.purpose];
    const paragraph = PARAGRAPHS[p.purpose];
    const minutes = Math.max(1, Math.round(p.expiresInMinutes));
    const expiryText = `This code expires in ${minutes} minute${minutes === 1 ? "" : "s"} and can only be used once.`;
    const closingNote = CLOSING_NOTES[p.purpose];

    const cardHtml = `
      <div style="padding:28px 24px 0;text-align:center;">
        ${emailIconBadge("seal-check")}
        ${emailHeroText({ heading, paragraph })}
        <div style="padding-top:28px;">${otpCodeBoxes(p.code)}</div>
        <p class="email-accent" style="margin:32px 0 12px;font-size:16px;font-weight:600;letter-spacing:-0.3px;">Copy code</p>
      </div>
      <div style="padding-top:28px;">${emailDivider()}</div>
      ${emailRowList([
        { icon: "clock", text: expiryText },
        {
          icon: "check",
          text: "The code verifies your account — you don't need to copy or enter anything special.",
        },
        { icon: "shield", text: closingNote },
      ])}`;

    const html = emailShell({
      headerHtml: emailHeader(),
      cardHtml,
      footerHtml: emailFooter({
        recipientEmail: ctx.recipientEmail,
        unsubscribeUrl: ctx.unsubscribeUrl,
      }),
    });

    const text = `${heading}\n\n${paragraph}\n\nYour code: ${p.code}\n\n${expiryText}\n${closingNote}`;
    return { html, text };
  },
};

import type { EmailTemplate } from "../types";
import {
  emailButton,
  emailDivider,
  emailFallbackLinkCard,
  emailFooter,
  emailHeader,
  emailHeroText,
  emailIconBadge,
  emailRowList,
  emailShell,
} from "./base";

/** Admin password-reset email — a link to choose a new password. */
export type AdminPasswordResetProps = {
  url: string;
  /** How long the reset link is valid, in minutes (must match the token TTL). */
  expiresInMinutes: number;
};

const HEADING = "Reset your Thrivo Admin password";
const PARAGRAPH =
  "We received a request to reset your admin password. Choose a new one using the button below.";

export const adminPasswordResetTemplate: EmailTemplate<AdminPasswordResetProps> = {
  subject: () => "Reset your Thrivo Admin password",
  render: (p, ctx) => {
    const minutes = Math.max(1, Math.round(p.expiresInMinutes));
    const expiryText = `This link expires in ${minutes} minute${minutes === 1 ? "" : "s"} and can only be used once.`;

    const cardHtml = `
      <div style="padding:28px 24px 0;text-align:center;">
        ${emailIconBadge("envelope")}
        ${emailHeroText({ heading: HEADING, paragraph: PARAGRAPH, headingMarginTop: 12, paragraphMarginTop: 12 })}
        <div style="padding:24px 0 28px;">${emailButton({ label: "Reset password", url: p.url, icon: "link" })}</div>
      </div>
      <div style="padding:0 24px;">${emailDivider()}</div>
      ${emailRowList([
        { icon: "clock", text: expiryText },
        {
          icon: "shield",
          text: "If you didn't request this, your password is unchanged and no action is needed.",
        },
      ])}`;

    const html = emailShell({
      headerHtml: emailHeader(),
      cardHtml,
      footerHtml:
        emailFallbackLinkCard({ url: p.url }) +
        emailFooter({ recipientEmail: ctx.recipientEmail, unsubscribeUrl: ctx.unsubscribeUrl }),
    });

    const text = `${HEADING}\n\n${PARAGRAPH}\n\nReset password: ${p.url}\n\n${expiryText}\nIf you didn't request this, your password is unchanged and no action is needed.`;
    return { html, text };
  },
};

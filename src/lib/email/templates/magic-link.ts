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

/** Passwordless sign-in email — one link, no code to type. */
export type MagicLinkProps = {
  url: string;
  /** How long the link is valid for, so the copy stays accurate if the TTL changes. */
  expiresInMinutes: number;
};

const HEADING = "Here's your sign-in link";
const PARAGRAPH =
  "We've sent the button below to sign in to your account. No password needed — the link does it all.";

export const magicLinkTemplate: EmailTemplate<MagicLinkProps> = {
  subject: () => "Your Thrivo sign-in link",
  render: (p, ctx) => {
    const minutes = Math.max(1, Math.round(p.expiresInMinutes));
    const expiryText = `The link expires in ${minutes} minute${minutes === 1 ? "" : "s"} and can only be used once.`;

    const cardHtml = `
      <div style="padding:28px 24px 0;text-align:center;">
        ${emailIconBadge("envelope")}
        ${emailHeroText({ heading: HEADING, paragraph: PARAGRAPH, headingMarginTop: 12, paragraphMarginTop: 12 })}
        <div style="padding:24px 0 28px;">${emailButton({ label: "Sign in to Thrivo", url: p.url, icon: "link" })}</div>
      </div>
      <div style="padding:0 24px;">${emailDivider()}</div>
      ${emailRowList([
        { icon: "clock", text: expiryText },
        {
          icon: "check",
          text: "The link signs you in automatically — you don't need to copy or enter anything.",
        },
        {
          icon: "shield",
          text: "If you didn't request this email, your account remains secure. No action needed.",
        },
      ])}`;

    const html = emailShell({
      headerHtml: emailHeader(),
      cardHtml,
      footerHtml:
        emailFallbackLinkCard({ url: p.url }) +
        emailFooter({ recipientEmail: ctx.recipientEmail, unsubscribeUrl: ctx.unsubscribeUrl }),
    });

    const text = `${HEADING}\n\n${PARAGRAPH}\n\nSign in to Thrivo: ${p.url}\n\n${expiryText}\nIf you didn't request this email, your account remains secure. No action needed.`;
    return { html, text };
  },
};

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

/** Admin-invite email — a link to set a password and activate the account. */
export type AdminInviteProps = {
  url: string;
  /** RBAC role the invitee is being granted, shown so they know their access level. */
  role: string;
  /** Who sent the invite, for trust. */
  invitedByEmail: string | null;
  /** How long the invite link is valid, in hours. */
  expiresInHours: number;
};

const HEADING = "You've been invited to Thrivo Admin";

export const adminInviteTemplate: EmailTemplate<AdminInviteProps> = {
  subject: () => "Your invitation to Thrivo Admin",
  render: (p, ctx) => {
    const hours = Math.max(1, Math.round(p.expiresInHours));
    const paragraph = `You've been invited to the Thrivo admin dashboard as ${p.role}${
      p.invitedByEmail ? ` by ${p.invitedByEmail}` : ""
    }. Set your password to activate your account.`;
    const expiryText = `This invitation expires in ${hours} hour${hours === 1 ? "" : "s"}.`;

    const cardHtml = `
      <div style="padding:28px 24px 0;text-align:center;">
        ${emailIconBadge("envelope")}
        ${emailHeroText({ heading: HEADING, paragraph, headingMarginTop: 12, paragraphMarginTop: 12 })}
        <div style="padding:24px 0 28px;">${emailButton({ label: "Set your password", url: p.url, icon: "link" })}</div>
      </div>
      <div style="padding:0 24px;">${emailDivider()}</div>
      ${emailRowList([
        { icon: "clock", text: expiryText },
        {
          icon: "shield",
          text: "If you weren't expecting this invitation, you can safely ignore this email.",
        },
      ])}`;

    const html = emailShell({
      headerHtml: emailHeader(),
      cardHtml,
      footerHtml:
        emailFallbackLinkCard({ url: p.url }) +
        emailFooter({ recipientEmail: ctx.recipientEmail, unsubscribeUrl: ctx.unsubscribeUrl }),
    });

    const text = `${HEADING}\n\n${paragraph}\n\nSet your password: ${p.url}\n\n${expiryText}\nIf you weren't expecting this invitation, you can safely ignore this email.`;
    return { html, text };
  },
};

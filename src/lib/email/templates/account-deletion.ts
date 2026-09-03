import type { EmailTemplate } from "../types";
import {
  emailButton,
  emailFooter,
  emailHeader,
  emailHeroText,
  emailShell,
  escapeHtml,
} from "./base";

export type AccountDeletionProps = {
  url: string;
  expiresInMinutes: number;
};

export const accountDeletionTemplate: EmailTemplate<AccountDeletionProps> = {
  subject: () => "Confirm your Thrivo account deletion",
  render: (props, ctx) => {
    const minutes = Math.max(1, Math.round(props.expiresInMinutes));
    const expiry = `This single-use link expires in ${minutes} minutes.`;
    const paragraph =
      "Someone requested permanent deletion of a Thrivo account using this email address. Confirm only if you made this request.";
    const cardHtml = `<div style="padding:28px 24px 24px;text-align:center;">
      ${emailHeroText({ heading: "Confirm account deletion", paragraph })}
      <div style="padding-top:24px;">${emailButton({ label: "Confirm deletion", url: props.url })}</div>
      <p class="email-body" style="margin:20px 0 0;font-size:13px;line-height:1.5;">${escapeHtml(expiry)}</p>
    </div>`;
    const html = emailShell({
      headerHtml: emailHeader(),
      cardHtml,
      footerHtml: emailFooter({ recipientEmail: ctx.recipientEmail }),
    });
    const text = `Confirm account deletion\n\n${paragraph}\n\nConfirm deletion: ${props.url}\n\n${expiry}\nIf you did not request this, ignore this email. Your account will not be deleted.`;
    return { html, text };
  },
};

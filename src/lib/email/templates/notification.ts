import type { EmailTemplate } from "../types";
import { emailButton, emailFooter, emailHeader, emailHeroText, emailShell } from "./base";

/**
 * Generic transactional notification: a title, a body, and an optional CTA.
 * Used by welcome, cancellation, and trial-reminder emails — the simplest
 * possible assembly of the shared blocks (no icon badge, no row list), which
 * is the point: proving the block set generalizes past the 3 bespoke designs
 * it was extracted from.
 */
export type NotificationProps = {
  title: string;
  body: string;
  cta?: { label: string; url: string };
};

export const notificationTemplate: EmailTemplate<NotificationProps> = {
  subject: (p) => p.title,
  render: (p, ctx) => {
    const button = p.cta
      ? `<div style="padding-top:24px;">${emailButton({ label: p.cta.label, url: p.cta.url })}</div>`
      : "";

    const cardHtml = `<div style="padding:28px 24px 24px;text-align:center;">
        ${emailHeroText({ heading: p.title, paragraph: p.body })}
        ${button}
      </div>`;

    const html = emailShell({
      headerHtml: emailHeader(),
      cardHtml,
      footerHtml: emailFooter({
        recipientEmail: ctx.recipientEmail,
        unsubscribeUrl: ctx.unsubscribeUrl,
      }),
    });

    const text = [p.title, "", p.body, p.cta ? `\n${p.cta.label}: ${p.cta.url}` : ""]
      .join("\n")
      .trim();

    return { html, text };
  },
};

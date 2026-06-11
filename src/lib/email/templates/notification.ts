import type { EmailTemplate } from "../types";
import { baseLayout, escapeHtml } from "./base";

/** Generic transactional notification: a title, a body, and an optional CTA. */
export type NotificationProps = {
  title: string;
  body: string;
  cta?: { label: string; url: string };
};

export const notificationTemplate: EmailTemplate<NotificationProps> = {
  subject: (p) => p.title,
  render: (p) => {
    const button = p.cta
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="border-radius:8px;background:#16a34a;">
           <a href="${encodeURI(p.cta.url)}" style="display:inline-block;padding:12px 20px;color:#ffffff;text-decoration:none;font-weight:600;">${escapeHtml(
             p.cta.label
           )}</a></td></tr></table>`
      : "";

    const contentHtml = `<h1 style="margin:0 0 12px;font-size:20px;">${escapeHtml(p.title)}</h1>
      <p style="margin:0;">${escapeHtml(p.body)}</p>${button}`;

    const text = [p.title, "", p.body, p.cta ? `\n${p.cta.label}: ${p.cta.url}` : ""]
      .join("\n")
      .trim();

    return { html: baseLayout({ contentHtml }), text };
  },
};

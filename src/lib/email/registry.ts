import type { EmailRenderContext, EmailTemplate } from "./types";
import { notificationTemplate, type NotificationProps } from "./templates/notification";
import { otpTemplate, type OtpProps } from "./templates/otp";
import { magicLinkTemplate, type MagicLinkProps } from "./templates/magic-link";
import { weeklyReviewTemplate, type WeeklyReviewProps } from "./templates/weekly-review";
import { adminInviteTemplate, type AdminInviteProps } from "./templates/admin-invite";
import {
  adminPasswordResetTemplate,
  type AdminPasswordResetProps,
} from "./templates/admin-password-reset";

/**
 * The typed template registry. Each key maps a template name to its props type,
 * giving `renderTemplate` end-to-end type safety. A2/A5 add the concrete
 * templates (welcome, trial-ending, cancellation) here behind the same shape.
 */
export type TemplateProps = {
  notification: NotificationProps;
  otp: OtpProps;
  "magic-link": MagicLinkProps;
  "weekly-review": WeeklyReviewProps;
  "admin-invite": AdminInviteProps;
  "admin-password-reset": AdminPasswordResetProps;
};

export type TemplateName = keyof TemplateProps;

const templates: { [K in TemplateName]: EmailTemplate<TemplateProps[K]> } = {
  notification: notificationTemplate,
  otp: otpTemplate,
  "magic-link": magicLinkTemplate,
  "weekly-review": weeklyReviewTemplate,
  "admin-invite": adminInviteTemplate,
  "admin-password-reset": adminPasswordResetTemplate,
};

export type RenderedEmail = { subject: string; html: string; text?: string };

/**
 * Render a registered template to a subject + body. Throws on an unknown name —
 * worker payloads arrive as `unknown`, so this is the runtime guard behind the
 * compile-time types. `ctx` defaults to an empty recipient so existing callers
 * that don't care about it (or tests) don't have to pass one.
 */
export function renderTemplate<K extends TemplateName>(
  name: K,
  props: TemplateProps[K],
  ctx: EmailRenderContext = { recipientEmail: "", unsubscribeUrl: "" }
): RenderedEmail {
  const template = templates[name];
  if (!template) throw new Error(`unknown email template: ${String(name)}`);
  return { subject: template.subject(props), ...template.render(props, ctx) };
}

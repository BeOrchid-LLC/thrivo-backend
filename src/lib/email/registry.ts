import { z } from "zod";
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
import { accountDeletionTemplate, type AccountDeletionProps } from "./templates/account-deletion";
import { EMAIL_CID_ATTACHMENTS } from "./assets";

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
  "account-deletion": AccountDeletionProps;
};

export type TemplateName = keyof TemplateProps;

export const templateSchemas = {
  notification: z.object({
    title: z.string().min(1).max(160),
    body: z.string().min(1).max(2_000),
    cta: z.object({ label: z.string().min(1).max(80), url: z.string().url() }).optional(),
  }),
  otp: z.object({
    code: z.string().min(4).max(12),
    purpose: z.enum(["sign-in", "email-verification", "password-reset"]),
    expiresInMinutes: z.number().int().positive(),
  }),
  "magic-link": z.object({ url: z.string().url(), expiresInMinutes: z.number().int().positive() }),
  "weekly-review": z.object({
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    loggedDays: z.number().int().min(0).max(7),
    previousLoggedDays: z.number().int().min(0).max(7),
    includeComparison: z.boolean(),
    joinedDuringPeriod: z.boolean(),
    progressUrl: z.string().url(),
  }),
  "admin-invite": z.object({
    url: z.string().url(),
    role: z.string().min(1),
    invitedByEmail: z.string().email().nullable(),
    expiresInHours: z.number().int().positive(),
  }),
  "admin-password-reset": z.object({
    url: z.string().url(),
    expiresInMinutes: z.number().int().positive(),
  }),
  "account-deletion": z.object({
    url: z.string().url(),
    expiresInMinutes: z.number().int().positive(),
  }),
} satisfies { [K in TemplateName]: z.ZodType<TemplateProps[K]> };

const templates: { [K in TemplateName]: EmailTemplate<TemplateProps[K]> } = {
  notification: notificationTemplate,
  otp: otpTemplate,
  "magic-link": magicLinkTemplate,
  "weekly-review": weeklyReviewTemplate,
  "admin-invite": adminInviteTemplate,
  "admin-password-reset": adminPasswordResetTemplate,
  "account-deletion": accountDeletionTemplate,
};

export type RenderedEmail = {
  subject: string;
  html: string;
  text?: string;
  attachments: typeof EMAIL_CID_ATTACHMENTS;
};

/**
 * Render a registered template to a subject + body. Throws on an unknown name —
 * worker payloads arrive as `unknown`, so this is the runtime guard behind the
 * compile-time types. `ctx` defaults to an empty recipient so existing callers
 * that don't care about it (or tests) don't have to pass one.
 */
export function renderTemplate<K extends TemplateName>(
  name: K,
  props: TemplateProps[K],
  ctx: EmailRenderContext = { recipientEmail: "" }
): RenderedEmail {
  const template = templates[name];
  if (!template) throw new Error(`unknown email template: ${String(name)}`);
  return {
    subject: template.subject(props),
    ...template.render(props, ctx),
    attachments: EMAIL_CID_ATTACHMENTS,
  };
}

export function parseTemplateProps<K extends TemplateName>(
  name: K,
  props: unknown
): TemplateProps[K] {
  const schema = templateSchemas[name];
  if (!schema) throw new Error(`unknown email template: ${String(name)}`);
  return schema.parse(props) as TemplateProps[K];
}

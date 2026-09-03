import { z } from "zod";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import type { EmailKind } from "../../db/schema";
import {
  emailLogRepo,
  emailOutboxRepo,
  emailReplayPayloadRepo,
  emailSuppressionRepo,
} from "../repositories";
import { encryptEmailPayload } from "../lib/email/outbox-crypto";
import { emailAppLink } from "../lib/email/links";
import {
  parseTemplateProps,
  templateSchemas,
  type TemplateName,
  type TemplateProps,
} from "../lib/email/registry";
import { env } from "../env";

/** The only data allowed in Redis for an email job. */
export type SendEmailJobData = { emailLogId: string };

export type StoredEmailPayload<K extends TemplateName = TemplateName> = {
  to: string;
  template: K;
  props: TemplateProps[K];
};

export type QueueTemplatedEmailInput<K extends TemplateName> = {
  kind: EmailKind;
  to: string;
  template: K;
  props: TemplateProps[K];
  expiresAt: Date;
  dedupeKey?: string;
  userId?: string;
  leadId?: string;
  parentEmailLogId?: string;
  /** Retain an encrypted payload for the short admin-resend window. */
  resendable?: boolean;
  transaction?: Executor;
};

const emailSchema = z
  .string()
  .email()
  .transform((value) => value.toLowerCase());

const templatesByKind: Record<EmailKind, readonly TemplateName[]> = {
  welcome: ["notification"],
  weekly_review: ["weekly-review"],
  trial_ending: ["notification"],
  cancellation_confirmation: ["notification"],
  waitlist_confirmation: ["notification"],
  admin_otp: ["otp"],
  admin_invite: ["admin-invite"],
  admin_password_reset: ["admin-password-reset"],
  account_deletion: ["account-deletion"],
  lead_contact: ["notification"],
  legacy_notification: ["notification", "magic-link", "otp"],
};

const notificationCtaSchema = (destination: "dashboard" | "subscription") =>
  z.object({
    label: z.string().min(1).max(80),
    url: z.literal(emailAppLink(destination)),
  });

const adminUrlSchema = z
  .string()
  .url()
  .refine((value) => new URL(value).origin === new URL(env.ADMIN_APP_URL).origin, {
    message: "Admin email links must use the configured admin origin",
  });

/** Runtime schemas bind each logical kind to its allowed props and central link destination. */
const kindPropsSchemas: Record<Exclude<EmailKind, "legacy_notification">, z.ZodTypeAny> = {
  welcome: templateSchemas.notification.extend({ cta: notificationCtaSchema("dashboard") }),
  weekly_review: templateSchemas["weekly-review"].extend({
    progressUrl: z.literal(emailAppLink("metrics")),
  }),
  trial_ending: templateSchemas.notification.extend({
    cta: notificationCtaSchema("subscription"),
  }),
  cancellation_confirmation: templateSchemas.notification.extend({
    cta: notificationCtaSchema("subscription"),
  }),
  waitlist_confirmation: templateSchemas.notification,
  admin_otp: templateSchemas.otp,
  admin_invite: templateSchemas["admin-invite"].extend({ url: adminUrlSchema }),
  admin_password_reset: templateSchemas["admin-password-reset"].extend({ url: adminUrlSchema }),
  account_deletion: templateSchemas["account-deletion"],
  lead_contact: templateSchemas.notification,
};

async function persistEmail<K extends TemplateName>(
  input: QueueTemplatedEmailInput<K>,
  tx: Executor
): Promise<string> {
  const to = emailSchema.parse(input.to);
  if (input.expiresAt <= new Date()) throw new Error("Email expiry must be in the future");
  if (!templatesByKind[input.kind].includes(input.template)) {
    throw new Error(`Template ${input.template} is not valid for email kind ${input.kind}`);
  }
  const templateProps = parseTemplateProps(input.template, input.props);
  const props =
    input.kind === "legacy_notification"
      ? templateProps
      : kindPropsSchemas[input.kind].parse(templateProps);
  const suppression = await emailSuppressionRepo.findActive(to, tx);
  const { row: log, created } = await emailLogRepo.logSendIdempotent(
    {
      userId: input.userId,
      leadId: input.leadId,
      parentEmailLogId: input.parentEmailLogId,
      toEmail: to,
      template: input.template,
      kind: input.kind,
      resendable: input.resendable ?? false,
      dedupeKey: input.dedupeKey,
      status: suppression ? "suppressed" : "queued",
      failureCode: suppression ? `suppressed:${suppression.reason}` : null,
      failedAt: suppression ? new Date() : null,
    },
    tx
  );
  if (!created || suppression) return log.id;

  const payload: StoredEmailPayload<K> = {
    to,
    template: input.template,
    props: props as TemplateProps[K],
  };
  const encrypted = encryptEmailPayload(payload, log.id, input.kind);
  await emailOutboxRepo.create(
    {
      emailLogId: log.id,
      encryptionKeyId: encrypted.keyId,
      payloadIv: encrypted.iv,
      payloadAuthTag: encrypted.authTag,
      payloadCiphertext: encrypted.ciphertext,
      expiresAt: input.expiresAt,
    },
    tx
  );
  if (input.resendable) {
    const replay = encryptEmailPayload(payload, log.id, input.kind);
    await emailReplayPayloadRepo?.create(
      {
        emailLogId: log.id,
        encryptionKeyId: replay.keyId,
        payloadIv: replay.iv,
        payloadAuthTag: replay.authTag,
        payloadCiphertext: replay.ciphertext,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
      tx
    );
  }
  return log.id;
}

/** Persist a validated email intent and encrypted payload; Redis is not touched here. */
export async function queueTemplatedEmail<K extends TemplateName>(
  input: QueueTemplatedEmailInput<K>
): Promise<string> {
  if (input.transaction) return persistEmail(input, input.transaction);
  return db.transaction((tx) => persistEmail(input, tx));
}

/** Queue one immediate, idempotent confirmation for a public waitlist signup. */
export async function queueWaitlistConfirmationEmail(email: string): Promise<string> {
  const normalizedEmail = email.trim().toLowerCase();
  return queueTemplatedEmail({
    kind: "waitlist_confirmation",
    to: normalizedEmail,
    template: "notification",
    props: {
      title: "You're on the Thrivo waitlist",
      body: "Thanks for joining the Thrivo waitlist. We'll email you when the app launches — no spam, just the launch update.",
    },
    dedupeKey: `waitlist_confirmation:${normalizedEmail}`,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
}

/** Queue a new delivery using a previously retained, already-validated payload. */
export async function queueEmailResend(input: {
  sourceId: string;
  kind: EmailKind;
  to: string;
  template: TemplateName;
  props: unknown;
  userId?: string | null;
  leadId?: string | null;
  idempotencyKey: string;
}): Promise<string> {
  return queueTemplatedEmail({
    kind: input.kind,
    to: input.to,
    template: input.template,
    props: input.props as never,
    userId: input.userId ?? undefined,
    leadId: input.leadId ?? undefined,
    parentEmailLogId: input.sourceId,
    resendable: true,
    dedupeKey: `admin-resend:${input.sourceId}:${input.idempotencyKey}`,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  } as never);
}

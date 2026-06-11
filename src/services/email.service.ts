import { emailLogRepo } from "../repositories";
import { enqueue, QUEUE_NAMES } from "../lib/queue";
import type { TemplateName, TemplateProps } from "../lib/email/registry";

/** Job payload for the `emails` queue. Rendered in the worker, not here. */
export type SendEmailJobData = {
  emailLogId: string;
  to: string;
  template: TemplateName;
  props: unknown;
};

export type SendTemplatedEmailInput<K extends TemplateName> = {
  to: string;
  template: K;
  props: TemplateProps[K];
  /** Owning user, when the send is tied to one (null for pre-signup leads). */
  userId?: string;
};

// BullMQ-level retries for transient send failures (handler rethrows them);
// failed jobs are kept for inspection rather than dropped.
const EMAIL_JOB_OPTS = {
  attempts: 4,
  backoff: { type: "exponential" as const, delay: 5000 },
  removeOnComplete: true,
  removeOnFail: false,
};

/**
 * Queue a transactional email. Records an `email_logs` row (status `queued`)
 * and enqueues a `send-email` job carrying the log id; the worker renders,
 * sends via Resend, and flips the status. Returns the email log id.
 *
 * If the enqueue fails (e.g. Redis down) it rethrows — the caller decides — and
 * the `queued` row remains as a recoverable artifact for a future sweep.
 */
export async function sendTemplatedEmail<K extends TemplateName>(
  input: SendTemplatedEmailInput<K>
): Promise<string> {
  const log = await emailLogRepo.logSend({
    userId: input.userId,
    toEmail: input.to,
    template: input.template,
    status: "queued",
  });

  const data: SendEmailJobData = {
    emailLogId: log.id,
    to: input.to,
    template: input.template,
    props: input.props,
  };
  await enqueue(QUEUE_NAMES.emails, "send-email", data, EMAIL_JOB_OPTS);
  return log.id;
}

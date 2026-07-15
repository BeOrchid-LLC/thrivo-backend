import type { Job } from "bullmq";
import { emailLogRepo } from "../../repositories";
import { renderTemplate, type TemplateName, type TemplateProps } from "../../lib/email/registry";
import { sendEmail, EmailNotConfiguredError } from "../../integrations/resend";
import { logger } from "../../lib/logger";
import type { SendEmailJobData } from "../../services/email.service";

/**
 * Worker handler for the `emails` queue: render the template, send via Resend,
 * and reconcile `email_logs`. On a transient send error it records `failed` and
 * rethrows so BullMQ retries with backoff; on a misconfiguration (no API key) it
 * records `failed` and returns — retrying a config error is pointless.
 */
export async function handleSendEmail(job: Job<SendEmailJobData>): Promise<void> {
  const { emailLogId, to, template, props } = job.data;
  logger.info({ jobId: job.id, emailLogId, template }, "email render started");
  const rendered = renderTemplate(template, props as TemplateProps[TemplateName], {
    recipientEmail: to,
    unsubscribeUrl: `https://thrivo.fit/unsubscribe?email=${encodeURIComponent(to)}`,
  });
  logger.info({ jobId: job.id, emailLogId, template }, "email render complete");

  try {
    logger.info({ jobId: job.id, emailLogId, template }, "email provider send started");
    const { id } = await sendEmail({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    logger.info(
      { jobId: job.id, emailLogId, template, providerMessageId: id },
      "email provider send complete"
    );
    await emailLogRepo.updateStatus(emailLogId, "sent", { providerMessageId: id });
    logger.info({ jobId: job.id, emailLogId, status: "sent" }, "email log status updated");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await emailLogRepo.updateStatus(emailLogId, "failed", { error: message });
    logger.error(
      { jobId: job.id, emailLogId, template, status: "failed", err },
      "email log status updated after send failure"
    );

    if (err instanceof EmailNotConfiguredError) {
      logger.warn({ emailLogId, template }, "email not sent: RESEND_API_KEY missing");
      return; // non-retryable
    }
    throw err; // transient — let BullMQ retry
  }
}

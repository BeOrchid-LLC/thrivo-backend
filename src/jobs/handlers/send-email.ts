import type { Job } from "bullmq";
import { db } from "../../../db";
import { env } from "../../env";
import { emailLogRepo, emailOutboxRepo, emailSuppressionRepo } from "../../repositories";
import { parseTemplateProps, renderTemplate, type TemplateName } from "../../lib/email/registry";
import { decryptEmailPayload } from "../../lib/email/outbox-crypto";
import { emailPublicLink } from "../../lib/email/links";
import { signWeeklyReviewPreferenceToken } from "../../lib/email/preference-token";
import {
  sendEmail,
  EmailNotConfiguredError,
  EmailSendError,
  isRetryableEmailError,
} from "../../integrations/resend";
import { logger } from "../../lib/logger";
import type { SendEmailJobData, StoredEmailPayload } from "../../services/email.service";

class PermanentEmailPayloadError extends Error {
  constructor() {
    super("Email payload failed validation or rendering");
    this.name = "PermanentEmailPayloadError";
  }
}

function safeError(err: unknown): string {
  if (err instanceof EmailNotConfiguredError) return "Email provider is not configured";
  if (err instanceof PermanentEmailPayloadError) return err.message;
  if (err instanceof EmailSendError) return err.message.slice(0, 500);
  return "Email delivery infrastructure error";
}

export async function handleSendEmail(job: Job<SendEmailJobData>): Promise<void> {
  const { emailLogId } = job.data;
  const [log, outbox] = await Promise.all([
    emailLogRepo.findById(emailLogId),
    emailOutboxRepo.findByEmailLogId(emailLogId),
  ]);
  if (!log || !outbox) {
    logger.warn({ jobId: job.id, emailLogId }, "email job has no durable payload");
    return;
  }
  if (
    ["sent", "delivered", "bounced", "complained", "suppressed", "failed", "expired"].includes(
      log.status
    )
  ) {
    return;
  }
  if (outbox.expiresAt <= new Date()) {
    await db.transaction(async (tx) => {
      await emailLogRepo.markTerminalFailure(
        emailLogId,
        "expired",
        "expired_before_send",
        undefined,
        tx
      );
      await emailOutboxRepo.complete(emailLogId, "expired", tx);
    });
    return;
  }

  await emailLogRepo.markAttempt(emailLogId, "processing");

  let providerMessageId: string | null = null;
  try {
    const suppression = await emailSuppressionRepo.findActive(log.toEmail);
    if (suppression) {
      await db.transaction(async (tx) => {
        await emailLogRepo.markTerminalFailure(
          emailLogId,
          "suppressed",
          `suppressed:${suppression.reason}`,
          undefined,
          tx
        );
        await emailOutboxRepo.complete(emailLogId, "failed", tx);
      });
      return;
    }
    if (!outbox.payloadIv || !outbox.payloadAuthTag || !outbox.payloadCiphertext) {
      throw new Error("Email outbox payload is unavailable");
    }
    let payload: StoredEmailPayload;
    let props: unknown;
    try {
      payload = decryptEmailPayload<StoredEmailPayload>(
        {
          keyId: outbox.encryptionKeyId,
          iv: outbox.payloadIv,
          authTag: outbox.payloadAuthTag,
          ciphertext: outbox.payloadCiphertext,
        },
        log.id,
        log.kind
      );
      props = parseTemplateProps(payload.template, payload.props);
    } catch {
      throw new PermanentEmailPayloadError();
    }

    let unsubscribeUrl: string | undefined;
    let headers: Record<string, string> | undefined;
    if (log.kind === "weekly_review" && log.userId) {
      const token = await signWeeklyReviewPreferenceToken(log.userId);
      unsubscribeUrl = emailPublicLink(`/unsubscribe?token=${encodeURIComponent(token)}`);
      const oneClick = new URL(
        "/api/v1/email-preferences/weekly-review/one-click",
        env.AUTH_BASE_URL
      );
      oneClick.searchParams.set("token", token);
      headers = {
        "List-Unsubscribe": `<${oneClick.toString()}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      };
    }

    let rendered: ReturnType<typeof renderTemplate>;
    try {
      rendered = renderTemplate(payload.template as TemplateName, props as never, {
        recipientEmail: payload.to,
        unsubscribeUrl,
      });
    } catch {
      throw new PermanentEmailPayloadError();
    }
    const { id } = await sendEmail({
      to: payload.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      headers,
      attachments: rendered.attachments,
      idempotencyKey: `thrivo-email/${emailLogId}`,
    });
    providerMessageId = id;
    await db.transaction(async (tx) => {
      await emailLogRepo.markSent(emailLogId, id, tx);
      await emailOutboxRepo.complete(emailLogId, "completed", tx);
    });
    logger.info(
      { jobId: job.id, emailLogId, kind: log.kind, providerMessageId: id },
      "email accepted"
    );
  } catch (err) {
    const retryable =
      providerMessageId !== null ||
      isRetryableEmailError(err) ||
      !(
        err instanceof EmailNotConfiguredError ||
        err instanceof PermanentEmailPayloadError ||
        err instanceof EmailSendError
      );
    const attempts = job.opts.attempts ?? 1;
    const hasRetry = retryable && job.attemptsMade + 1 < attempts;
    const message = safeError(err);
    if (hasRetry) {
      await emailLogRepo.updateStatus(emailLogId, "retrying", {
        error: message,
        failureCode: providerMessageId
          ? "post_acceptance_persistence_error"
          : "transient_delivery_error",
      });
      throw err;
    }

    // A provider acceptance followed by one failed audit transaction gets one
    // final persistence-only recovery attempt. Never start a second, unbounded
    // retry horizon that could outlive Resend's 24-hour idempotency window.
    if (providerMessageId) {
      const acceptedId = providerMessageId;
      try {
        await db.transaction(async (tx) => {
          await emailLogRepo.markSent(emailLogId, acceptedId, tx);
          await emailOutboxRepo.complete(emailLogId, "completed", tx);
        });
        logger.info(
          { jobId: job.id, emailLogId, kind: log.kind, providerMessageId: acceptedId },
          "email acceptance audit recovered"
        );
        return;
      } catch {
        // Fall through to the terminal audit path. If the database is still
        // unavailable, BullMQ records the failure without re-sending forever.
      }
    }

    await db.transaction(async (tx) => {
      await emailLogRepo.markTerminalFailure(
        emailLogId,
        "failed",
        err instanceof EmailNotConfiguredError
          ? "provider_not_configured"
          : providerMessageId
            ? "post_acceptance_persistence_exhausted"
            : retryable
              ? "retry_exhausted"
              : "permanent_send_error",
        message,
        tx
      );
      await emailOutboxRepo.complete(emailLogId, "failed", tx);
    });
    logger.error({ jobId: job.id, emailLogId, kind: log.kind, err }, "email delivery failed");
    if (retryable) throw err;
  }
}

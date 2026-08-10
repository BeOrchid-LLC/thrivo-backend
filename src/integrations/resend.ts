import { env } from "../env";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

/** No API key configured — a misconfiguration, not a transient fault (don't retry). */
export class EmailNotConfiguredError extends Error {
  constructor() {
    super("RESEND_API_KEY is not set; email send skipped");
    this.name = "EmailNotConfiguredError";
  }
}

/** A send failed. `status` is the Resend HTTP status when there was a response. */
export class EmailSendError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false
  ) {
    super(message);
    this.name = "EmailSendError";
  }
}

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  headers?: Record<string, string>;
  attachments?: Array<{
    filename: string;
    content: string;
    contentType?: string;
    contentId?: string;
  }>;
  idempotencyKey?: string;
};

export type SendEmailResult = { id: string };

export function isRetryableEmailError(err: unknown): boolean {
  return err instanceof EmailSendError && err.retryable;
}

async function postOnce(input: SendEmailInput, apiKey: string): Promise<SendEmailResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        ...(input.idempotencyKey ? { "idempotency-key": input.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: input.from ?? env.EMAIL_FROM,
        to: input.to,
        subject: input.subject,
        html: input.html,
        ...(input.text ? { text: input.text } : {}),
        ...(input.headers ? { headers: input.headers } : {}),
        ...(input.attachments ? { attachments: input.attachments } : {}),
      }),
      signal: controller.signal,
    });
  } catch {
    // Network error or timeout abort — transient, retryable (no status).
    throw new EmailSendError("Resend request failed before a response", undefined, true);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // Do not retain provider bodies: they may echo recipient or template data.
    const retryable =
      res.status === 408 || res.status === 409 || res.status === 429 || res.status >= 500;
    throw new EmailSendError(`Resend responded with HTTP ${res.status}`, res.status, retryable);
  }

  const json = (await res.json().catch(() => ({}))) as { id?: string };
  if (!json.id) throw new EmailSendError("Resend response missing message id", undefined, true);
  return { id: json.id };
}

/**
 * Send one transactional email via Resend. A thin fetch client (no SDK):
 * 10s timeout and no internal retries: BullMQ is the single retry owner. Throws
 * `EmailNotConfiguredError` when no key is set and `EmailSendError` otherwise —
 * the worker handler maps these to `email_logs` status.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) throw new EmailNotConfiguredError();
  return postOnce(input, apiKey);
}

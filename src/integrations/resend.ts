import { env } from "../env";
import { withRetry } from "../lib/retry";

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
    readonly status?: number
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
};

export type SendEmailResult = { id: string };

// Retry network blips and Resend 5xx; never retry a 4xx (bad payload won't heal).
function isRetryable(err: unknown): boolean {
  return err instanceof EmailSendError && (err.status === undefined || err.status >= 500);
}

async function postOnce(input: SendEmailInput, apiKey: string): Promise<SendEmailResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: input.from ?? env.EMAIL_FROM,
        to: input.to,
        subject: input.subject,
        html: input.html,
        ...(input.text ? { text: input.text } : {}),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    // Network error or timeout abort — transient, retryable (no status).
    throw new EmailSendError(`network error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new EmailSendError(`resend responded ${res.status}: ${body.slice(0, 200)}`, res.status);
  }

  const json = (await res.json().catch(() => ({}))) as { id?: string };
  if (!json.id) throw new EmailSendError("resend response missing message id");
  return { id: json.id };
}

/**
 * Send one transactional email via Resend. A thin fetch client (no SDK):
 * 10s timeout, backoff retries on transient failures. Throws
 * `EmailNotConfiguredError` when no key is set and `EmailSendError` otherwise —
 * the worker handler maps these to `email_logs` status.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) throw new EmailNotConfiguredError();
  return withRetry(() => postOnce(input, apiKey), { retries: 2, shouldRetry: isRetryable });
}

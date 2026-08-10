import { Webhook } from "svix";
import { z } from "zod";
import { env } from "../env";
import { ForbiddenError } from "../lib/errors";
import { emailLogRepo, emailSuppressionRepo, webhookEventRepo } from "../repositories";
import type { WebhookEvent } from "../repositories/webhook-event.repository";

const resendEventSchema = z.object({
  type: z.string(),
  created_at: z.string().datetime().optional(),
  data: z
    .object({
      email_id: z.string().min(1),
      to: z.union([z.string().email(), z.array(z.string().email())]).optional(),
      bounce: z.object({ type: z.string().optional() }).passthrough().optional(),
    })
    .passthrough(),
});

export type ResendWebhookOutcome = "processed" | "duplicate" | "pending" | "ignored";

export function parseResendWebhook(body: string, headers: Record<string, string>): unknown {
  if (!env.RESEND_WEBHOOK_SECRET) throw new ForbiddenError("Webhook receiver is not configured");
  try {
    return new Webhook(env.RESEND_WEBHOOK_SECRET).verify(body, headers);
  } catch {
    throw new ForbiddenError("Invalid webhook signature");
  }
}

function mappedStatus(type: string) {
  switch (type) {
    case "email.sent":
    case "email.delivery_delayed":
      return "sent" as const;
    case "email.delivered":
      return "delivered" as const;
    case "email.bounced":
      return "bounced" as const;
    case "email.complained":
      return "complained" as const;
    case "email.suppressed":
      return "suppressed" as const;
    case "email.failed":
      return "failed" as const;
    default:
      return null;
  }
}

async function processLedger(ledger: WebhookEvent): Promise<ResendWebhookOutcome> {
  const event = resendEventSchema.parse(ledger.payload);
  const status = mappedStatus(event.type);
  if (!status) {
    await webhookEventRepo.markProcessed(ledger.id, "processed");
    return "ignored";
  }
  const eventAt = event.created_at ? new Date(event.created_at) : ledger.receivedAt;
  const log = await emailLogRepo.applyProviderEvent(event.data.email_id, status, eventAt);
  if (!log) return "pending";

  const recipient = Array.isArray(event.data.to) ? event.data.to[0] : event.data.to;
  if (recipient && status === "complained") {
    await emailSuppressionRepo.suppress(recipient, "complained", ledger.eventId);
  } else if (recipient && status === "suppressed") {
    await emailSuppressionRepo.suppress(recipient, "provider_suppressed", ledger.eventId);
  } else if (
    recipient &&
    status === "bounced" &&
    /permanent|hard/i.test(event.data.bounce?.type ?? "")
  ) {
    await emailSuppressionRepo.suppress(recipient, "permanent_bounce", ledger.eventId);
  }
  await webhookEventRepo.markProcessed(ledger.id, "processed");
  return "processed";
}

export async function handleResendWebhook(
  eventId: string,
  payload: unknown
): Promise<ResendWebhookOutcome> {
  let ledger = await webhookEventRepo.recordReceived({
    provider: "resend",
    eventId,
    payload: payload as object,
  });
  if (!ledger) {
    const existing = await webhookEventRepo.findByProviderEvent("resend", eventId);
    if (existing?.status === "processed") return "duplicate";
    ledger = existing;
  }
  if (!ledger) return "duplicate";
  return processLedger(ledger);
}

export async function reconcilePendingResendEvents(): Promise<number> {
  const rows = await webhookEventRepo.listReceived("resend", 100);
  let processed = 0;
  for (const row of rows) {
    if ((await processLedger(row)) !== "pending") processed += 1;
  }
  return processed;
}

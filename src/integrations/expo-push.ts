import { env } from "../env";
import { logger } from "../lib/logger";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const MAX_PER_REQUEST = 100; // Expo accepts up to 100 messages per call

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface ExpoPushResult {
  /** Tokens Expo reported as DeviceNotRegistered — caller should prune them. */
  invalidTokens: string[];
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

interface ExpoTicket {
  status: "ok" | "error";
  details?: { error?: string };
}

/** Detect dead tokens in one batch's tickets (index-aligned with the request). */
export function collectInvalidTokens(batch: ExpoPushMessage[], tickets: ExpoTicket[]): string[] {
  const dead: string[] = [];
  tickets.forEach((ticket, i) => {
    if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
      const token = batch[i]?.to;
      if (token) dead.push(token);
    }
  });
  return dead;
}

/**
 * Send Expo push messages, chunked to Expo's per-request limit. EXPO_ACCESS_TOKEN
 * is optional (it raises rate limits / enables enhanced security) — sends work
 * without it. A non-2xx response throws so BullMQ retries; dead tokens are
 * returned for lazy pruning, never deleted here.
 */
export async function sendExpoPush(messages: ExpoPushMessage[]): Promise<ExpoPushResult> {
  const invalidTokens: string[] = [];

  for (const batch of chunk(messages, MAX_PER_REQUEST)) {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(env.EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(batch),
    });

    if (!res.ok) {
      logger.error({ status: res.status }, "expo push request failed");
      throw new Error(`Expo push failed with status ${res.status}`);
    }

    const json = (await res.json()) as { data?: ExpoTicket[] };
    invalidTokens.push(...collectInvalidTokens(batch, json.data ?? []));
  }

  return { invalidTokens };
}

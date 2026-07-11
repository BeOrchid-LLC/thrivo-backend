import { env } from "../env";
import { logger } from "../lib/logger";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
export const EXPO_MAX_PER_REQUEST = 100; // Expo accepts up to 100 messages per call
const TIMEOUT_MS = 8_000; // same AbortController pattern as the OFF/Resend clients (R5-3/I15)

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
 * Send one Expo push request (must already be ≤100 messages — Expo's per-request
 * limit). Timeout-bounded with the same AbortController pattern as the OFF/Resend
 * clients (R5-3/I15) — previously this client was the only one with no timeout,
 * so a hung request could stall a worker indefinitely. EXPO_ACCESS_TOKEN is
 * optional (it raises rate limits / enables enhanced security) — sends work
 * without it. A non-2xx response or timeout throws so the caller's retry policy
 * applies; dead tokens are returned for lazy pruning, never deleted here.
 */
export async function sendExpoPushBatch(batch: ExpoPushMessage[]): Promise<ExpoPushResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(env.EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(batch),
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(
      `Expo push request failed: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    logger.error({ status: res.status }, "expo push request failed");
    throw new Error(`Expo push failed with status ${res.status}`);
  }

  const json = (await res.json()) as { data?: ExpoTicket[] };
  return { invalidTokens: collectInvalidTokens(batch, json.data ?? []) };
}

import Anthropic from "@anthropic-ai/sdk";
import { env } from "../../env";
import { UpstreamError } from "../../lib/errors";

let client: Anthropic | null = null;

/**
 * Lazily construct the Anthropic client. Fails fast (not a silent no-op) when
 * the feature's key is unset — the caller surfaces a clear error rather than
 * guessing nutrition.
 */
export function getAnthropic(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    throw new UpstreamError("AI estimate is not configured");
  }
  if (!client) {
    client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return client;
}

/** Whether the AI estimate feature is configured. */
export function isAnthropicConfigured(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

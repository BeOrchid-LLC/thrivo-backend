import Anthropic from "@anthropic-ai/sdk";
import { env } from "../../env";
import { UpstreamError } from "../../lib/errors";
import { logger } from "../../lib/logger";

let client: Anthropic | null = null;

/**
 * Lazily construct the Anthropic client. Fails at use (not a silent no-op) when
 * the feature's key is unset — logs the missing var for operators and surfaces a
 * clear error to the caller rather than guessing nutrition.
 */
export function getAnthropic(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    logger.error("ANTHROPIC_API_KEY is not set; AI estimate cannot run");
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

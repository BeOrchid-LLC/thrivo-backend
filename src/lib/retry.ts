/** Tunables for {@link withRetry}. All optional; sensible defaults below. */
export type RetryOptions = {
  /** Extra attempts after the first (so total attempts = retries + 1). Default 2. */
  retries?: number;
  /** Base backoff before the first retry, in ms. Default 200. */
  baseMs?: number;
  /** Backoff multiplier per attempt. Default 2 (exponential). */
  factor?: number;
  /** Cap on any single backoff, in ms. Default 5000. */
  maxDelayMs?: number;
  /** Decide whether an error is worth retrying. Default: retry everything. */
  shouldRetry?: (err: unknown) => boolean;
  /** Injectable sleep — overridden in tests to avoid real timers. */
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn`, retrying transient failures with exponential backoff + full jitter.
 * Rethrows the last error once attempts are exhausted (or `shouldRetry` says no),
 * so a caller never mistakes a give-up for a success. Shared by `integrations/*`
 * clients (Resend now; Open Food Facts in A2).
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    retries = 2,
    baseMs = 200,
    factor = 2,
    maxDelayMs = 5000,
    shouldRetry = () => true,
    sleep = defaultSleep,
  } = options;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !shouldRetry(err)) break;
      // Full jitter: a random point in [0, exponential window], capped.
      const window = Math.min(maxDelayMs, baseMs * factor ** attempt);
      await sleep(Math.random() * window);
    }
  }
  throw lastErr;
}

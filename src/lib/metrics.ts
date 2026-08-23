import { logger } from "./logger";

/** Structured metric hook; production log/observability pipelines can aggregate these events. */
export function metric(name: string, value = 1, fields: Record<string, unknown> = {}): void {
  logger.info({ metric: name, value, ...fields }, "metric");
}

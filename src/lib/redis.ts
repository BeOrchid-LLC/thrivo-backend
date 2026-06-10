import { Redis } from "ioredis";
import { env } from "../env";
import { logger } from "./logger";

let client: Redis | null = null;

/** Lazily-created shared Redis client for caching + general use. */
export function getRedis(): Redis {
  if (!client) {
    client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
    client.on("error", (err) => logger.error({ err }, "redis error"));
    client.on("connect", () => logger.info("redis connected"));
  }
  return client;
}

/** Liveness probe for /ready — returns false instead of throwing so health stays graceful. */
export async function pingRedis(): Promise<boolean> {
  try {
    return (await getRedis().ping()) === "PONG";
  } catch (err) {
    logger.error({ err }, "redis ping failed");
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}

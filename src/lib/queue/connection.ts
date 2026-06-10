import { env } from "../../env";

// Connection *options* (not an ioredis instance) so BullMQ owns its own ioredis
// lifecycle — this avoids coupling to BullMQ's bundled ioredis type identity and
// lets BullMQ manage `maxRetriesPerRequest: null` for its blocking connections.
const url = new URL(env.REDIS_URL);

export const redisConnectionOptions = {
  host: url.hostname,
  port: url.port ? Number(url.port) : 6379,
  username: url.username ? decodeURIComponent(url.username) : undefined,
  password: url.password ? decodeURIComponent(url.password) : undefined,
  ...(url.protocol === "rediss:" ? { tls: {} } : {}),
};

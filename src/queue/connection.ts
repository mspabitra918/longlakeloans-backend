import IORedis, { type RedisOptions } from "ioredis";

/**
 * Shared Redis connection for BullMQ (producer side, used inside the Vercel API)
 * and re-used by the always-on worker process running on the VPS.
 *
 * BullMQ requires `maxRetriesPerRequest: null`. When pointing at Upstash, use a
 * `rediss://` URL so ioredis negotiates TLS automatically.
 */
export const REDIS_URL = process.env.REDIS_URL || "";

let connection: IORedis | null = null;

export function getRedisConnection(): IORedis {
  if (connection) return connection;

  if (!REDIS_URL) {
    throw new Error(
      "REDIS_URL is not configured — the bank-verification drip queue requires Redis (Upstash).",
    );
  }

  const options: RedisOptions = {
    // Required by BullMQ: blocking commands must not give up after N retries.
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };

  connection = new IORedis(REDIS_URL, options);

  connection.on("error", (err) => {
    console.error("Redis connection error:", err.message);
  });

  return connection;
}

/** True when a Redis URL is configured. Lets callers degrade gracefully. */
export function isQueueEnabled(): boolean {
  return Boolean(REDIS_URL);
}

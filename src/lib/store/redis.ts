import Redis from "ioredis";
import { env } from "../env";

let client: Redis | undefined;

/** Single shared client. REDIS_URL (Redis Cloud) or local redis://127.0.0.1:6379. */
export function redis(): Redis {
  if (!client) {
    client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
      connectTimeout: 5_000,
      // Bounded backoff. The default retries forever at growing intervals; a request in flight should fail fast instead.
      retryStrategy: (n) => (n > 5 ? null : Math.min(50 * 2 ** n, 1_500)),
    });
    let lastErr = 0;
    client.on("error", (e) => {
      // OOM / ECONNREFUSED arrive once per queued command; one line per second is enough to see it.
      const now = Date.now(); if (now - lastErr < 1_000) return; lastErr = now;
      console.error("[redis]", e.message);
    });
  }
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = undefined;
  }
}

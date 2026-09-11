import Redis from "ioredis";

let client: Redis | undefined;

/** Single shared client. REDIS_URL (Redis Cloud) or local redis://127.0.0.1:6379. */
export function redis(): Redis {
  if (!client) {
    const url = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
    client = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: false });
    client.on("error", (e) => console.error("[redis]", e.message));
  }
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = undefined;
  }
}

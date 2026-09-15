/**
 * Tests run against a real Redis on a scratch port (default 6390), not a mock: the state and embed
 * layers lean on ZSET/pipeline/Buffer semantics that mocks get subtly wrong (ioredis-mock 8 breaks
 * ZRANGE under ioredis 6). `pnpm test` starts one if none is listening; set TEST_REDIS_URL to
 * point elsewhere. The DB is flushed before every test.
 */
import { vi, beforeEach, afterAll } from "vitest";
import Redis from "ioredis";

const url = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6390";
if (/6379\b/.test(url) && !process.env.I_KNOW_THIS_FLUSHES_6379) throw new Error("refusing to run tests against the default Redis port");
// Vitest runs files in parallel workers. Each worker gets its own logical DB (0-15) so one file's
// flushdb cannot wipe another mid-test. VITEST_POOL_ID is 1-based.
const db = (Number(process.env.VITEST_POOL_ID ?? 1) - 1) % 16;
const client = new Redis(url, { db, maxRetriesPerRequest: 2, lazyConnect: false });
client.on("error", () => { /* surfaced by the first command */ });

vi.mock("@/lib/store/redis", () => ({ redis: () => client, closeRedis: async () => {} }));
vi.mock("../lib/store/redis", () => ({ redis: () => client, closeRedis: async () => {} }));

beforeEach(async () => {
  await client.flushdb();
  // In-process caches must not outlive the data they cache.
  const { _resetMatrixCache } = await import("@/lib/embed");
  _resetMatrixCache();
});
afterAll(async () => { await client.quit(); });

export { client as mockRedis };

/**
 * Every test runs against an in-memory Redis (ioredis-mock) so state/embed/related tests exercise
 * the real pipelines and key schema, not a hand-rolled fake. The store is wiped between tests.
 */
import { vi, beforeEach } from "vitest";
import RedisMock from "ioredis-mock";

const client = new RedisMock();
vi.mock("@/lib/store/redis", () => ({ redis: () => client, closeRedis: async () => {} }));
vi.mock("../lib/store/redis", () => ({ redis: () => client, closeRedis: async () => {} }));

beforeEach(async () => { await client.flushall(); });

export { client as mockRedis };

import { describe, it, expect, vi, afterEach } from "vitest";
import { charge, spentToday, SK, COST } from "./spend";
import { HttpError } from "./guard";
import { mockRedis } from "@/test/setup";

afterEach(() => vi.unstubAllEnvs());

describe("spend cap", () => {
  it("accumulates cents per bucket for the UTC day, with a TTL", async () => {
    await charge("ask"); await charge("ask"); await charge("voice");
    expect(await spentToday()).toEqual({ ask: 2 * COST.ask, voice: COST.voice });
    expect(await mockRedis.ttl(SK())).toBeGreaterThan(86_400);
  });
  it("refuses with 503 + Retry-After to UTC midnight once the day's total would pass the cap, and does not count the refused call", async () => {
    // DAILY_USD is read at import; simulate a nearly-spent day instead of re-importing.
    const { DAILY_USD } = await import("./spend");
    await mockRedis.hset(SK(), "ask", DAILY_USD * 100 - 1);
    await expect(charge("ask")).rejects.toMatchObject({ status: 503 });
    try { await charge("voice"); } catch (e) {
      const ra = Number((e as HttpError).headers["Retry-After"]);
      expect(ra).toBeGreaterThan(0); expect(ra).toBeLessThanOrEqual(86_400);
    }
    expect((await spentToday()).ask).toBe(DAILY_USD * 100 - 1);   // the refused cents were given back
    expect((await spentToday()).voice ?? 0).toBe(0);
  });
  it("a request that fits exactly is allowed", async () => {
    const { DAILY_USD } = await import("./spend");
    await mockRedis.hset(SK(), "ask", DAILY_USD * 100 - COST.ask);
    await expect(charge("ask")).resolves.toBe(DAILY_USD * 100);
  });
});

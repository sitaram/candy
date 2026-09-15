import { describe, it, expect, vi, afterEach } from "vitest";
import { charge, refund, spentToday, SK, COST, DAILY_USD_UID, DAILY_USD_IP } from "./spend";
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
  it("caps one uid before the global cap: a single caller cannot drain everyone's budget", async () => {
    const who = { uid: "u1", ip: "1.2.3.4" };
    await mockRedis.hset(`${SK()}:u:u1`, "voice", DAILY_USD_UID * 100 - 1);
    await expect(charge("voice", who)).rejects.toMatchObject({ status: 503 });
    expect((await spentToday()).voice ?? 0).toBe(0);                          // global untouched after refund
    await expect(charge("voice", { uid: "u2", ip: "5.6.7.8" })).resolves.toBeGreaterThan(0);   // another user is fine
  });
  it("caps one IP across uids: dropping the cookie does not reset the budget", async () => {
    await mockRedis.hset(`${SK()}:ip:9.9.9.9`, "ask", DAILY_USD_IP * 100 - 1);
    await expect(charge("ask", { uid: "fresh1", ip: "9.9.9.9" })).rejects.toMatchObject({ status: 503 });
    await expect(charge("ask", { uid: "fresh2", ip: "9.9.9.9" })).rejects.toMatchObject({ status: 503 });
  });
  it("refund gives back every tier", async () => {
    const who = { uid: "u1", ip: "1.2.3.4" };
    await charge("card", who); await refund("card", who);
    expect((await spentToday()).card ?? 0).toBe(0);
    expect(Number(await mockRedis.hget(`${SK()}:u:u1`, "card"))).toBe(0);
    expect(Number(await mockRedis.hget(`${SK()}:ip:1.2.3.4`, "card"))).toBe(0);
  });
  it("fails closed when Redis is unreachable", async () => {
    const orig = mockRedis.pipeline.bind(mockRedis);
    mockRedis.pipeline = (() => ({ hincrby() { return this; }, hvals() { return this; }, expire() { return this; }, exec: () => Promise.reject(new Error("ECONNREFUSED")) })) as unknown as typeof mockRedis.pipeline;
    try { await expect(charge("ask")).rejects.toMatchObject({ status: 503 }); } finally { mockRedis.pipeline = orig; }
  });
});

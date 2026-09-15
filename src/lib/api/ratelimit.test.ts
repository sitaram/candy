import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { rateLimit, RATE_LIMITS } from "./ratelimit";

beforeAll(() => vi.useFakeTimers({ now: 1_700_000_000_000 }));
afterAll(() => vi.useRealTimers());

describe("rateLimit", () => {
  it("allows n, refuses n+1, with a Retry-After that reaches the next window", async () => {
    const { n, windowSec } = RATE_LIMITS.voice;
    for (let i = 0; i < n; i++) expect((await rateLimit("voice", "u1")).ok).toBe(true);
    const r = await rateLimit("voice", "u1");
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.retryAfter).toBeGreaterThan(0); expect(r.retryAfter).toBeLessThanOrEqual(windowSec); }
  });
  it("is per caller and per bucket", async () => {
    const { n } = RATE_LIMITS.voice;
    for (let i = 0; i < n; i++) await rateLimit("voice", "u1");
    expect((await rateLimit("voice", "u1")).ok).toBe(false);
    expect((await rateLimit("voice", "u2")).ok).toBe(true);
    expect((await rateLimit("read", "u1")).ok).toBe(true);
  });
  it("resets when the window rolls", async () => {
    const { n, windowSec } = RATE_LIMITS.beacon;
    for (let i = 0; i <= n; i++) await rateLimit("beacon", "u1");
    expect((await rateLimit("beacon", "u1")).ok).toBe(false);
    vi.setSystemTime(Date.now() + (windowSec + 1) * 1000);
    expect((await rateLimit("beacon", "u1")).ok).toBe(true);
  });
  it("fails open when Redis throws", async () => {
    const mod = await import("@/lib/store/redis");
    const spy = vi.spyOn(mod, "redis").mockImplementation(() => { throw new Error("ECONNREFUSED"); });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await rateLimit("read", "u9")).ok).toBe(true);
    spy.mockRestore(); warn.mockRestore();
  });
});

import { describe, it, expect } from "vitest";
import { observe, todayStats, routeKey, bucketOf, MK } from "./metrics";
import { mockRedis } from "@/test/setup";

const flush = () => new Promise((r) => setTimeout(r, 20));

describe("route metrics", () => {
  it("collapses dynamic segments to one row", () => {
    expect(routeKey("/api/items/openai/codex")).toBe("/api/items/:id");
    expect(routeKey("/api/items/openai/codex/related")).toBe("/api/items/:id/related");
    expect(routeKey("/r/openai/codex")).toBe("/r/:id");
    expect(routeKey("/api/feed")).toBe("/api/feed");
  });
  it("buckets by fixed edges", () => {
    expect(bucketOf(0)).toBe("b:50"); expect(bucketOf(50)).toBe("b:50"); expect(bucketOf(51)).toBe("b:100"); expect(bucketOf(9999)).toBe("b:inf");
  });
  it("observe() is fire-and-forget and todayStats() reads p50/p95/counts back", async () => {
    for (const ms of [30, 60, 90, 120, 700]) observe("/api/feed", ms, 200);
    observe("/api/feed", 40, 500);
    observe("/api/items/a/b", 300, 404);
    await flush();
    const st = await todayStats();
    const feed = st.find((s) => s.path === "/api/feed")!;
    expect(feed.n).toBe(6);
    expect(feed.p50).toBe(100);          // 30,40 ≤50 (2/6); +60,90 ≤100 → 4/6 ≥ .5
    expect(feed.p95).toBe(800);
    expect(feed.err5xx).toBe(1);
    expect(feed.avgMs).toBe(Math.round((30 + 60 + 90 + 120 + 700 + 40) / 6));
    expect(st.find((s) => s.path === "/api/items/:id")).toMatchObject({ n: 1, err4xx: 1 });
    expect(await mockRedis.ttl(MK("/api/feed"))).toBeGreaterThan(13 * 86_400);
    expect(st[0].path).toBe("/api/feed");   // busiest first
  });
});

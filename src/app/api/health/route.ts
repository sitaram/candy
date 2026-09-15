import { redis } from "@/lib/store/redis";
import { currentVersion } from "@/lib/corpus/snapshot";
import { spentToday, DAILY_USD } from "@/lib/api/spend";
import { queueDepth } from "@/lib/corpus/backfill";
import { todayStats } from "@/lib/api/metrics";

export const dynamic = "force-dynamic";

/**
 * GET /api/health → 200 { ok, redisMs, corpusVer, spend, backfillQueue, routes[] } or 503 when Redis is unreachable.
 * `routes` is today's per-route n / avg / p50 / p95 / 4xx / 5xx from lib/api/metrics.
 * No uid, no rate limit: this is for an uptime probe, and it reveals nothing about a user. It does
 * reveal today's model spend in cents and the queue depth, which is what you want on a dashboard.
 */
export async function GET(): Promise<Response> {
  const t0 = Date.now();
  try {
    const r = redis();
    const [pong, ver, spend, queue, routes] = await Promise.all([r.ping(), currentVersion(), spentToday(), queueDepth(), todayStats()]);
    const cents = Object.values(spend).reduce((a, b) => a + b, 0);
    return Response.json({ ok: pong === "PONG", redisMs: Date.now() - t0, corpusVer: ver, spend: { ...spend, totalCents: cents, capUsd: DAILY_USD }, backfillQueue: queue, routes }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ ok: false, error: "redis unreachable", redisMs: Date.now() - t0 }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}

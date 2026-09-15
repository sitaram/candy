import { redis } from "@/lib/store/redis";
import { currentVersion } from "@/lib/corpus/snapshot";
import { spentToday, DAILY_USD } from "@/lib/api/spend";
import { queueDepth } from "@/lib/corpus/backfill";

export const dynamic = "force-dynamic";

/**
 * GET /api/health → 200 { ok, redisMs, corpusVer, spend, backfillQueue } or 503 when Redis is unreachable.
 * No uid, no rate limit: this is for an uptime probe, and it reveals nothing about a user. It does
 * reveal today's model spend in cents and the queue depth, which is what you want on a dashboard.
 */
export async function GET(): Promise<Response> {
  const t0 = Date.now();
  try {
    const r = redis();
    const [pong, ver, spend, queue] = await Promise.all([r.ping(), currentVersion(), spentToday(), queueDepth()]);
    const cents = Object.values(spend).reduce((a, b) => a + b, 0);
    return Response.json({ ok: pong === "PONG", redisMs: Date.now() - t0, corpusVer: ver, spend: { ...spend, totalCents: cents, capUsd: DAILY_USD }, backfillQueue: queue }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ ok: false, error: "redis unreachable", redisMs: Date.now() - t0 }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}

import { redis } from "@/lib/store/redis";
import { currentVersion } from "@/lib/corpus/snapshot";
import { spentToday, DAILY_USD } from "@/lib/api/spend";
import { queueDepth } from "@/lib/corpus/backfill";
import { todayStats } from "@/lib/api/metrics";

export const dynamic = "force-dynamic";

/**
 * GET /api/health → 200 { ok, redisMs, corpusVer } or 503 when Redis is unreachable. No uid, no rate limit:
 * an uptime probe. The dashboard half — today's spend against the cap, backfill queue, per-route p95 —
 * tells an attacker exactly how far the budget is from the 503, so it is only returned when the request
 * carries `x-candy-admin: $CANDY_ADMIN_TOKEN`. Unset token → dashboard never returned.
 */
export async function GET(req: Request): Promise<Response> {
  const t0 = Date.now();
  const admin = !!process.env.CANDY_ADMIN_TOKEN && req.headers.get("x-candy-admin") === process.env.CANDY_ADMIN_TOKEN;
  try {
    const r = redis();
    const [pong, ver] = await Promise.all([r.ping(), currentVersion()]);
    const base = { ok: pong === "PONG", redisMs: Date.now() - t0, corpusVer: ver };
    if (!admin) return Response.json(base, { headers: { "cache-control": "no-store" } });
    const [spend, queue, routes] = await Promise.all([spentToday(), queueDepth(), todayStats()]);
    const cents = Object.values(spend).reduce((a, b) => a + b, 0);
    return Response.json({ ...base, spend: { ...spend, totalCents: cents, capUsd: DAILY_USD }, backfillQueue: queue, routes }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ ok: false, error: "redis unreachable", redisMs: Date.now() - t0 }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}

/**
 * Per-route latency and status counts, in Redis, one HINCRBY pipeline per request, fire-and-forget.
 *
 *   m:{day}:{path}   HASH  n, ms (sum), p50/p95 buckets as b:<upper-ms>, s:<status-class>
 *
 * Buckets are fixed edges (50, 100, 200, 400, 800, 1600, 3200, +∞ ms) so a percentile is a walk over eight
 * fields, not a sorted set per request. Precision is the bucket width; that is enough to see "the feed
 * went from 100 ms to 800 ms" — which is the question this exists to answer. Kept 14 days.
 *
 * `/api/health` reports today's per-route p50/p95/n/5xx. Nothing here is on the response path: the guard
 * calls `observe()` after it has the response and does not await it.
 */
import { redis } from "@/lib/store/redis";

export const EDGES = [50, 100, 200, 400, 800, 1600, 3200] as const;
const day = () => new Date().toISOString().slice(0, 10);
export const MK = (path: string, d = day()) => `m:${d}:${path}`;

/** Collapse dynamic segments so /api/items/a/b and /api/items/c/d share a row. */
export function routeKey(pathname: string): string {
  return pathname.replace(/^\/api\/items\/[^/]+\/[^/]+(\/related)?$/, "/api/items/:id$1").replace(/^\/r\/[^/]+\/[^/]+$/, "/r/:id");
}

export function bucketOf(ms: number): string {
  for (const e of EDGES) if (ms <= e) return `b:${e}`;
  return "b:inf";
}

let lastWarn = 0;

export function observe(pathname: string, ms: number, status: number): void {
  const key = MK(routeKey(pathname));
  try {
    const p = redis().pipeline().hincrby(key, "n", 1).hincrby(key, "ms", Math.round(ms)).hincrby(key, bucketOf(ms), 1).hincrby(key, `s:${Math.floor(status / 100)}xx`, 1).expire(key, 14 * 86_400);
    void p.exec().catch((e) => { if (Date.now() - lastWarn > 60_000) { lastWarn = Date.now(); console.warn("[metrics]", (e as Error).message); } });
  } catch { /* a metrics failure is never a request failure */ }
}

export interface RouteStats { path: string; n: number; avgMs: number; p50: number; p95: number; err5xx: number; err4xx: number }

/** Percentile from bucket counts: the upper edge of the bucket where the cumulative count crosses q. */
function pct(h: Record<string, string>, n: number, q: number): number {
  let acc = 0;
  for (const e of EDGES) { acc += Number(h[`b:${e}`] ?? 0); if (acc / n >= q) return e; }
  return Infinity;
}

export async function todayStats(): Promise<RouteStats[]> {
  const r = redis();
  const keys: string[] = [];
  let cursor = "0";
  do { const [c, ks] = await r.scan(cursor, "MATCH", MK("*"), "COUNT", 200); cursor = c; keys.push(...ks); } while (cursor !== "0");
  if (!keys.length) return [];
  const rows = await Promise.all(keys.map((k) => r.hgetall(k)));
  const prefix = MK("");
  return keys.map((k, i) => {
    const h = rows[i], n = Number(h.n ?? 0);
    return { path: k.slice(prefix.length), n, avgMs: n ? Math.round(Number(h.ms ?? 0) / n) : 0, p50: n ? pct(h, n, 0.5) : 0, p95: n ? pct(h, n, 0.95) : 0, err5xx: Number(h["s:5xx"] ?? 0), err4xx: Number(h["s:4xx"] ?? 0) };
  }).sort((a, b) => b.n - a.n);
}

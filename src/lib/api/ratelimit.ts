/**
 * Fixed-window rate limits in Redis, one INCR + EXPIRE per call, keyed by bucket and caller.
 *
 * Buckets are sized by what the route *costs us*, not by how often a human would call it:
 *   read   — Redis only. Generous; a fast swiper does ~2/s.
 *   write  — Redis writes (reactions, reset). A human can't click 60 times a minute.
 *   llm    — one text-model call per request (ask). Cents each.
 *   voice  — mints a realtime session. Dollars per hour if abused.
 *   fetch  — may hit GitHub + Claude to bring a new repo into the corpus. Pennies each, unbounded
 *            in aggregate if a URL scanner walks /api/items/*, so it is the tightest.
 *
 * Fails open: if Redis is down the limit is skipped and the request proceeds — a down cache must
 * not take the read path with it. The failure is logged once a minute.
 */
import { redis } from "@/lib/store/redis";

export type Bucket = "read" | "write" | "llm" | "voice" | "fetch" | "beacon";

const LIMITS: Record<Bucket, { n: number; windowSec: number }> = {
  read:   { n: 240, windowSec: 60 },
  write:  { n: 90,  windowSec: 60 },
  llm:    { n: 20,  windowSec: 60 },
  voice:  { n: 10,  windowSec: 600 },
  fetch:  { n: 30,  windowSec: 600 },
  beacon: { n: 30,  windowSec: 60 },
};

let lastWarn = 0;

export async function rateLimit(bucket: Bucket, who: string): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
  const { n, windowSec } = LIMITS[bucket];
  const now = Math.floor(Date.now() / 1000);
  const win = Math.floor(now / windowSec);
  const key = `rl:${bucket}:${who}:${win}`;
  try {
    const r = redis();
    const [[, count]] = (await r.pipeline().incr(key).expire(key, windowSec + 1).exec()) as [[null, number], unknown];
    if (count <= n) return { ok: true };
    return { ok: false, retryAfter: (win + 1) * windowSec - now };
  } catch (e) {
    if (Date.now() - lastWarn > 60_000) { lastWarn = Date.now(); console.warn("[ratelimit] redis unavailable; failing open", (e as Error).message); }
    return { ok: true };
  }
}

/** For tests and admin tooling. */
export const RATE_LIMITS: Readonly<typeof LIMITS> = LIMITS;

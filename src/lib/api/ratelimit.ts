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
 * Redis down: read/write/beacon fail OPEN (a down cache must not take the read path with it); the
 * buckets that cost money — llm, voice, fetch, embed — fail CLOSED, since without the counter we
 * cannot bound anything. Logged once a minute either way.
 */
import { redis } from "@/lib/store/redis";

export type Bucket = "read" | "embed" | "write" | "llm" | "voice" | "fetch" | "beacon";

/**
 * `n` is per uid. `ip` is a second, looser ceiling per client IP shared by every uid behind it, for
 * the buckets that cost money: a caller who drops the cookie gets a fresh uid and a fresh uid-bucket,
 * but not a fresh IP. Sized so an office NAT of ~20 people does not trip it.
 */
const LIMITS: Record<Bucket, { n: number; windowSec: number; ip?: number }> = {
  // read/write cost only Redis, but without an IP ceiling a caller who drops the cookie each request has
  // no limit at all (fresh uid, fresh bucket). Sized for an office NAT of ~20 heavy users.
  read:   { n: 240, windowSec: 60,  ip: 2_400 },
  embed:  { n: 60,  windowSec: 60,  ip: 300 },   // search: one embeddings call each (~$0.00002, but a call)
  write:  { n: 90,  windowSec: 60,  ip: 900 },
  llm:    { n: 20,  windowSec: 60,  ip: 120 },
  voice:  { n: 10,  windowSec: 600, ip: 60 },
  fetch:  { n: 30,  windowSec: 600, ip: 120 },
  beacon: { n: 30,  windowSec: 60,  ip: 120 },
};

const MONEY = new Set<Bucket>(["llm", "voice", "fetch", "embed"]);
let lastWarn = 0;

export async function rateLimit(bucket: Bucket, who: string, ip?: string): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
  const { n, windowSec, ip: ipCap } = LIMITS[bucket];
  const now = Math.floor(Date.now() / 1000);
  const win = Math.floor(now / windowSec);
  const key = `rl:${bucket}:${who}:${win}`;
  const ipKey = ipCap && ip ? `rl:${bucket}:ip:${ip}:${win}` : null;
  try {
    const r = redis();
    const p = r.pipeline().incr(key).expire(key, windowSec + 1);
    if (ipKey) p.incr(ipKey).expire(ipKey, windowSec + 1);
    const res = (await p.exec()) as [null, number][];
    const count = res[0][1];
    const ipCount = ipKey ? res[2][1] : 0;
    if (count <= n && (!ipCap || ipCount <= ipCap)) return { ok: true };
    return { ok: false, retryAfter: (win + 1) * windowSec - now };
  } catch (e) {
    const closed = MONEY.has(bucket);
    if (Date.now() - lastWarn > 60_000) { lastWarn = Date.now(); console.warn(`[ratelimit] redis unavailable; failing ${closed ? "closed" : "open"} for ${bucket}`, (e as Error).message); }
    return closed ? { ok: false, retryAfter: 60 } : { ok: true };
  }
}

/** For tests and admin tooling. */
export const RATE_LIMITS: Readonly<typeof LIMITS> = LIMITS;

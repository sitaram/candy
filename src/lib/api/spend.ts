/**
 * Global daily ceiling on what the *product* can spend on models, in cents, in Redis.
 *
 * Per-user rate limits bound one caller; they do not bound the sum. At 20 asks/min per uid and
 * 120/min per IP, one address could run ~$2,600/day of Haiku before any limit refused. The crawl has
 * had `budget:llm:{day}` for a while; this is the same idea for the request path.
 *
 *   spend:{day}   HASH  bucket → cents (integer, rounded up), 3 d TTL
 *
 * `charge()` is called *before* the call with the expected cost, so a burst cannot overshoot by more
 * than one request per concurrent caller. Estimates are deliberately round and conservative; the point
 * is a ceiling that turns a leaked-cookie night into a bounded bill, not accounting.
 *
 * Fails open like the rate limiter: a Redis outage must not take the product down with it.
 */
import { redis } from "@/lib/store/redis";
import { HttpError } from "./guard";

export type SpendBucket = "ask" | "voice" | "embed" | "card";

/** Cents per call, rounded up. */
export const COST: Record<SpendBucket, number> = {
  ask: 2,      // Haiku, ~15k cached input + 700 out
  voice: 25,   // one realtime session, capped at 10 min by expires_after
  embed: 1,    // one query embedding is ~$0.00002 — a cent is 500× too much, but a cent per search is the honest ceiling on volume
  card: 1,     // one Haiku card on backfill
};

/** Dollars per day across all buckets. */
export const DAILY_USD = Number(process.env.CANDY_DAILY_USD ?? 25);

const day = () => new Date().toISOString().slice(0, 10);
export const SK = (d = day()) => `spend:${d}`;

let lastWarn = 0;

/**
 * Reserve `cost` cents (default: the bucket's estimate). Throws HttpError 503 with Retry-After to the
 * next UTC midnight when the day's total would exceed DAILY_USD. Returns the running total in cents.
 */
export async function charge(bucket: SpendBucket, cost = COST[bucket]): Promise<number> {
  const key = SK();
  let total = 0;
  try {
    const r = redis();
    const res = await r.pipeline().hincrby(key, bucket, cost).hvals(key).expire(key, 3 * 86_400).exec();
    total = ((res?.[1]?.[1] as string[]) ?? []).reduce((a, v) => a + Number(v), 0);
  } catch (e) {
    if (Date.now() - lastWarn > 60_000) { lastWarn = Date.now(); console.warn("[spend] redis unavailable; failing open", (e as Error).message); }
    return 0;
  }
  if (total > DAILY_USD * 100) {
    // Give it back so the counter reflects what was actually spent, not what was refused.
    await redis().hincrby(key, bucket, -cost).catch(() => {});
    const now = new Date();
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    console.warn(`[spend] daily cap $${DAILY_USD} reached (${bucket}); refusing until UTC midnight`);
    throw new HttpError(503, "daily model budget reached; try again tomorrow", { "Retry-After": String(Math.ceil((midnight - now.getTime()) / 1000)) });
  }
  return total;
}

/** For `pnpm stats` and tests. */
export async function spentToday(): Promise<Record<string, number>> {
  const h = await redis().hgetall(SK());
  return Object.fromEntries(Object.entries(h).map(([k, v]) => [k, Number(v)]));
}

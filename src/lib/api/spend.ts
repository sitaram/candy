/**
 * Daily ceilings on what the product can spend on models, in cents, in Redis.
 *
 *   spend:{day}            HASH  bucket → cents     global, 3 d TTL
 *   spend:{day}:u:{uid}    HASH  bucket → cents     per user
 *   spend:{day}:ip:{ip}    HASH  bucket → cents     per client IP
 *
 * Three ceilings, checked innermost first: one uid, one IP, everyone. Per-user rate limits bound how
 * *often* one caller can ask; these bound how much they can *cost*. Without the per-caller tiers a
 * single IP could reach the global cap in ~17 minutes of voice minting and 503 every other user until
 * UTC midnight — the global cap was a kill switch anyone could pull.
 *
 * `charge()` is called *before* the call with the expected cost; `refund()` gives it back on paths
 * that never reached the provider (404, 4xx from us). Estimates are round and conservative.
 *
 * Fails CLOSED. A Redis outage means we cannot see the running total; the only bounded answer is
 * "not right now". The read path (feed, search-without-semantic, cards) does not go through here and
 * stays up; only model spend pauses.
 */
import { redis } from "@/lib/store/redis";
import { HttpError } from "./guard";
import { alert } from "@/lib/errors/alert";

export type SpendBucket = "ask" | "voice" | "embed" | "card";

/** Cents per call, rounded up. */
export const COST: Record<SpendBucket, number> = {
  ask: 2,      // Haiku, ~15k cached input + 700 out
  voice: 25,   // one realtime session. expires_after bounds the *secret*, not the call; the session itself is bounded
               // by the client's 3-min mutual-silence hang-up and max_output_tokens per turn. Real worst case is higher;
               // the per-uid/IP tiers, not this number, are what keep one caller bounded.
  embed: 1,    // one query embedding is ~$0.00002 — a cent is 500× too much, but a cent per search is the honest ceiling on volume
  card: 1,     // one Haiku card on backfill
};

/** Dollars per day. Global, then per uid, then per IP. */
export const DAILY_USD = Number(process.env.CANDY_DAILY_USD ?? 25);
export const DAILY_USD_UID = Number(process.env.CANDY_DAILY_USD_UID ?? 3);   // ~12 voice sessions or 150 asks
export const DAILY_USD_IP = Number(process.env.CANDY_DAILY_USD_IP ?? 8);     // an office NAT of a few heavy users

const day = () => new Date().toISOString().slice(0, 10);
export const SK = (d = day()) => `spend:${d}`;

let lastWarn = 0;
const sum = (h: string[] | undefined) => (h ?? []).reduce((a, v) => a + Number(v), 0);

function untilMidnight(): string {
  const now = new Date();
  return String(Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()) / 1000));
}

export interface Caller { uid?: string; ip?: string }

/**
 * Reserve `cost` cents against every applicable ceiling. Throws HttpError 503 with Retry-After to the
 * next UTC midnight when any would be exceeded (and undoes the reservation). Returns the global total.
 */
export async function charge(bucket: SpendBucket, who: Caller = {}, cost = COST[bucket]): Promise<number> {
  const k = SK();
  const keys = [k, ...(who.uid ? [`${k}:u:${who.uid}`] : []), ...(who.ip && who.ip !== "ip:unknown" ? [`${k}:ip:${who.ip}`] : [])];
  const caps = [DAILY_USD, DAILY_USD_UID, DAILY_USD_IP].slice(0, keys.length).map((d) => d * 100);
  let totals: number[];
  try {
    const p = redis().pipeline();
    for (const key of keys) p.hincrby(key, bucket, cost).hvals(key).expire(key, 3 * 86_400);
    const res = await p.exec();
    if (!res) throw new Error("pipeline returned null");
    totals = keys.map((_, i) => sum(res[i * 3 + 1]?.[1] as string[] | undefined));
  } catch (e) {
    if (Date.now() - lastWarn > 60_000) { lastWarn = Date.now(); console.error("[spend] redis unavailable; refusing model spend (fail closed)", (e as Error).message); }
    throw new HttpError(503, "model spend is paused; try again shortly", { "Retry-After": "60" });
  }
  const over = totals.findIndex((t, i) => t > caps[i]);
  if (over >= 0) {
    await refund(bucket, who, cost);
    const scope = over === 0 ? "global" : keys[over].includes(":u:") ? "user" : "ip";
    if (scope === "global") {
      console.warn(`[spend] daily cap $${DAILY_USD} reached (${bucket}); refusing until UTC midnight`);
      alert("spend-cap", `daily model budget $${DAILY_USD} reached; ${bucket} refused. Refusing until UTC midnight.`);
    } else console.info(`[spend] ${scope} daily cap reached for ${bucket}`);
    throw new HttpError(503, scope === "global" ? "daily model budget reached; try again tomorrow" : "you've used today's voice and question budget; more tomorrow", { "Retry-After": untilMidnight() });
  }
  return totals[0];
}

/** Undo a reservation for a call that never reached the provider. Best effort. */
export async function refund(bucket: SpendBucket, who: Caller = {}, cost = COST[bucket]): Promise<void> {
  const k = SK();
  const keys = [k, ...(who.uid ? [`${k}:u:${who.uid}`] : []), ...(who.ip && who.ip !== "ip:unknown" ? [`${k}:ip:${who.ip}`] : [])];
  try { const p = redis().pipeline(); for (const key of keys) p.hincrby(key, bucket, -cost); await p.exec(); } catch { /* best effort */ }
}

/** For `pnpm stats` and tests. */
export async function spentToday(): Promise<Record<string, number>> {
  const h = await redis().hgetall(SK());
  return Object.fromEntries(Object.entries(h).map(([k, v]) => [k, Number(v)]));
}

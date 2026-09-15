/**
 * Corpus snapshot: the whole read model in one gzip'd key, plus a version counter.
 *
 * Before: every cold process assembled allItems() from ~5k Redis reads (1.1 s at 1.2k repos, and
 * linear). At 5k repos that is ~5 s per Vercel cold start, per lambda — past the feed's whole
 * budget. Now: one GET (~300 KB gz) + gunzip + parse, ~40 ms, flat in item count until ~20k.
 *
 * Writers bump `corpus:ver`; readers compare their cached ver every 30 s and reload on change.
 * A missing snapshot falls back to the slow path and writes one, so this is safe to deploy over
 * an existing corpus and self-heals if the key is ever lost.
 */
import { gunzipSync, gzipSync } from "node:zlib";
import { redis } from "../store/redis";
import type { Item } from "./api";

export const SK = { snap: "corpus:snap", ver: "corpus:ver" } as const;

export async function writeSnapshot(items: Item[]): Promise<number> {
  const buf = gzipSync(Buffer.from(JSON.stringify(items), "utf8"));
  const r = redis();
  const [, ver] = await Promise.all([r.set(SK.snap, buf), r.incr(SK.ver)]);
  return ver;
}

export async function readSnapshot(): Promise<{ items: Item[]; ver: number } | null> {
  const r = redis();
  const [buf, ver] = await Promise.all([r.getBuffer(SK.snap), r.get(SK.ver)]);
  if (!buf) return null;
  try {
    return { items: JSON.parse(gunzipSync(buf).toString("utf8")) as Item[], ver: Number(ver ?? 0) };
  } catch (e) {
    console.warn("[snapshot] corrupt, rebuilding:", (e as Error).message);
    await r.del(SK.snap);
    return null;
  }
}

/** Any write that changes what allItems() would return calls this. Cheap; readers notice within 30 s. */
export async function bumpVersion(): Promise<void> {
  await redis().incr(SK.ver);
}

export async function currentVersion(): Promise<number> {
  return Number((await redis().get(SK.ver)) ?? 0);
}

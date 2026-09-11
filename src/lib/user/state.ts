/**
 * Per-user state. Tiny, separate from the corpus.
 *
 * u:{uid}:seen     ZSET id -> ts        never show twice; "since last time"
 * u:{uid}:react    HASH id -> kind      like | skip | save | dive
 * u:{uid}:saved    ZSET id -> ts        the trail to act on later
 * u:{uid}:profile  HASH term -> weight  derived interest vector over card terms
 * u:{uid}:meta     HASH                 profileUpdatedAt, lastVisit, reactions, seedSource
 */
import type { Item } from "../corpus/api";
import { redis } from "../store/redis";

export type Reaction = "like" | "skip" | "save" | "dive";

const DELTA: Record<Reaction, number> = { like: 1, save: 2, dive: 1.5, skip: -0.5 };
const DECAY_PER_DAY = 0.98;

export const UK = {
  seen: (u: string) => `u:${u}:seen`,
  react: (u: string) => `u:${u}:react`,
  saved: (u: string) => `u:${u}:saved`,
  profile: (u: string) => `u:${u}:profile`,
  meta: (u: string) => `u:${u}:meta`,
};

/** Terms an item contributes to / is matched against the profile. */
export function itemTerms(it: Item): { term: string; w: number }[] {
  const c = it.card;
  const out: { term: string; w: number }[] = [];
  if (c) {
    for (const t of c.tags) out.push({ term: t.toLowerCase(), w: 1 });
    for (const t of c.ecosystem) out.push({ term: t.toLowerCase(), w: 1 });
    out.push({ term: `cat:${c.category}`, w: 0.6 });
  }
  if (it.repo.language) out.push({ term: `lang:${it.repo.language.toLowerCase()}`, w: 0.5 });
  return out;
}

export type Profile = Map<string, number>;

export async function getProfile(uid: string): Promise<Profile> {
  const h = await redis().hgetall(UK.profile(uid));
  return new Map(Object.entries(h).map(([k, v]) => [k, Number(v)]));
}

export async function getSeen(uid: string): Promise<Set<string>> {
  return new Set(await redis().zrange(UK.seen(uid), "0", "-1"));
}

export async function getReactions(uid: string): Promise<Map<string, Reaction>> {
  const h = await redis().hgetall(UK.react(uid));
  return new Map(Object.entries(h) as [string, Reaction][]);
}

export async function markSeen(uid: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const now = Date.now();
  const args: (string | number)[] = [];
  for (const id of ids) args.push(now, id);
  await redis().zadd(UK.seen(uid), "NX", ...args);
}

/** Record a reaction and update the profile. Fast: one pipeline. */
export async function react(uid: string, item: Item, kind: Reaction): Promise<void> {
  const r = redis();
  const id = item.repo.id;
  const now = Date.now();

  // Lazy decay of the whole profile since last update.
  const meta = await r.hgetall(UK.meta(uid));
  const last = Number(meta.profileUpdatedAt ?? 0);
  const profile = await getProfile(uid);
  if (last && profile.size) {
    const days = (now - last) / 86_400_000;
    const f = Math.pow(DECAY_PER_DAY, days);
    for (const [k, v] of profile) profile.set(k, v * f);
  }
  const delta = DELTA[kind];
  for (const { term, w } of itemTerms(item)) profile.set(term, (profile.get(term) ?? 0) + delta * w);
  // Prune tiny weights so the hash stays small.
  for (const [k, v] of profile) if (Math.abs(v) < 0.05) profile.delete(k);

  const p = r.pipeline();
  p.zadd(UK.seen(uid), now, id);
  p.hset(UK.react(uid), id, kind);
  if (kind === "save") p.zadd(UK.saved(uid), now, id);
  p.del(UK.profile(uid));
  if (profile.size) p.hset(UK.profile(uid), Object.fromEntries(Array.from(profile, ([k, v]) => [k, v.toFixed(4)])));
  p.hset(UK.meta(uid), { profileUpdatedAt: now, lastVisit: now });
  p.hincrby(UK.meta(uid), "reactions", 1);
  p.hincrby(UK.meta(uid), `n_${kind}`, 1);
  await p.exec();
}

export async function touchVisit(uid: string): Promise<{ lastVisit: number }> {
  const r = redis();
  const prev = Number((await r.hget(UK.meta(uid), "lastVisit")) ?? 0);
  await r.hset(UK.meta(uid), "lastVisit", Date.now());
  return { lastVisit: prev };
}

export interface Me {
  uid: string;
  reactions: number;
  counts: Record<Reaction, number>;
  topTerms: { term: string; w: number }[];
  avoidTerms: { term: string; w: number }[];
  saved: string[];
  seen: number;
  lastVisit: number;
}

export async function me(uid: string): Promise<Me> {
  const r = redis();
  const [meta, profile, saved, seen] = await Promise.all([r.hgetall(UK.meta(uid)), getProfile(uid), r.zrevrange(UK.saved(uid), 0, 49), r.zcard(UK.seen(uid))]);
  const sorted = Array.from(profile, ([term, w]) => ({ term, w })).sort((a, b) => b.w - a.w);
  return {
    uid,
    reactions: Number(meta.reactions ?? 0),
    counts: { like: Number(meta.n_like ?? 0), skip: Number(meta.n_skip ?? 0), save: Number(meta.n_save ?? 0), dive: Number(meta.n_dive ?? 0) },
    topTerms: sorted.filter((x) => x.w > 0).slice(0, 15),
    avoidTerms: sorted.filter((x) => x.w < 0).slice(-8).reverse(),
    saved,
    seen,
    lastVisit: Number(meta.lastVisit ?? 0),
  };
}

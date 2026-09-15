/**
 * Per-user state. Tiny, separate from the corpus.
 *
 * u:{uid}:seen     ZSET id -> ts        never show twice; "since last time"
 * u:{uid}:react    HASH id -> kind      like | skip | save | dive
 * u:{uid}:saved    ZSET id -> ts        the trail to act on later
 * u:{uid}:profile  HASH term -> weight  derived interest vector over card terms
 * u:{uid}:meta     HASH                 profileUpdatedAt, lastVisit, reactions, seedSource
 */
import type Redis from "ioredis";
import type { Item } from "../corpus/api";
import { redis } from "../store/redis";
import { EK, nudgeTaste } from "../embed";

export type Reaction = "like" | "skip" | "save" | "dive";
/** Reversals. `unsave` removes a bookmark; `undo` reverts the last like/skip and un-sees the item. */
export type Action = Reaction | "unsave" | "undo";

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

async function decayedProfile(uid: string, now: number): Promise<Profile> {
  const r = redis();
  const last = Number((await r.hget(UK.meta(uid), "profileUpdatedAt")) ?? 0);
  const profile = await getProfile(uid);
  if (last && profile.size) {
    const f = Math.pow(DECAY_PER_DAY, (now - last) / 86_400_000);
    for (const [k, v] of profile) profile.set(k, v * f);
  }
  return profile;
}

function applyDelta(profile: Profile, item: Item, delta: number): void {
  for (const { term, w } of itemTerms(item)) profile.set(term, (profile.get(term) ?? 0) + delta * w);
  for (const [k, v] of profile) if (Math.abs(v) < 0.05) profile.delete(k);
}

function writeProfile(p: ReturnType<Redis["pipeline"]>, uid: string, profile: Profile, now: number): void {
  p.del(UK.profile(uid));
  if (profile.size) p.hset(UK.profile(uid), Object.fromEntries(Array.from(profile, ([k, v]) => [k, v.toFixed(4)])));
  p.hset(UK.meta(uid), { profileUpdatedAt: now, lastVisit: now });
}

/** Record a reaction and update the profile. Fast: one pipeline. */
export async function react(uid: string, item: Item, kind: Reaction): Promise<void> {
  const r = redis();
  const id = item.repo.id;
  const now = Date.now();
  const profile = await decayedProfile(uid, now);
  applyDelta(profile, item, DELTA[kind]);

  const p = r.pipeline();
  // Bookmarking does not dismiss the card, so it must not mark it seen.
  if (kind !== "save") {
    p.zadd(UK.seen(uid), now, id);
    p.hset(UK.react(uid), id, kind);
  } else p.zadd(UK.saved(uid), now, id);
  writeProfile(p, uid, profile, now);
  p.hincrby(UK.meta(uid), "reactions", 1);
  p.hincrby(UK.meta(uid), `n_${kind}`, 1);
  await Promise.all([p.exec(), nudgeTaste(uid, id, DELTA[kind])]);
}

/** Remove a bookmark and reverse its profile contribution. */
export async function unsave(uid: string, item: Item): Promise<void> {
  const r = redis();
  const now = Date.now();
  const profile = await decayedProfile(uid, now);
  applyDelta(profile, item, -DELTA.save);
  const p = r.pipeline();
  p.zrem(UK.saved(uid), item.repo.id);
  writeProfile(p, uid, profile, now);
  p.hincrby(UK.meta(uid), "n_save", -1);
  await Promise.all([p.exec(), nudgeTaste(uid, item.repo.id, -DELTA.save, { reverse: true })]);
}

/** Revert a like/skip: un-see the item, reverse the profile delta. */
export async function undo(uid: string, item: Item): Promise<boolean> {
  const r = redis();
  const id = item.repo.id;
  const prev = (await r.hget(UK.react(uid), id)) as Reaction | null;
  if (prev !== "like" && prev !== "skip") return false;
  const now = Date.now();
  const profile = await decayedProfile(uid, now);
  applyDelta(profile, item, -DELTA[prev]);
  const p = r.pipeline();
  p.zrem(UK.seen(uid), id);
  p.hdel(UK.react(uid), id);
  writeProfile(p, uid, profile, now);
  p.hincrby(UK.meta(uid), "reactions", -1);
  p.hincrby(UK.meta(uid), `n_${prev}`, -1);
  await Promise.all([p.exec(), nudgeTaste(uid, id, -DELTA[prev], { reverse: true })]);
  return true;
}

export async function isSaved(uid: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const scores = await redis().zmscore(UK.saved(uid), ...ids);
  return new Set(ids.filter((_, i) => scores[i] != null));
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
  /** like/skip/dive history, newest first, with the time it happened */
  liked: { id: string; at: number }[];
  skipped: { id: string; at: number }[];
  dived: { id: string; at: number }[];
  seen: number;
  lastVisit: number;
  firstSeen: number;
  tasteWeight: number;
}

export async function me(uid: string): Promise<Me> {
  const r = redis();
  const [meta, profile, saved, seen, react, seenTs, tw] = await Promise.all([
    r.hgetall(UK.meta(uid)), getProfile(uid), r.zrevrange(UK.saved(uid), 0, 49), r.zcard(UK.seen(uid)),
    r.hgetall(UK.react(uid)), r.zrange(UK.seen(uid), "0", "-1", "WITHSCORES"), r.get(EK.tastew(uid)),
  ]);
  const at = new Map<string, number>();
  for (let i = 0; i < seenTs.length; i += 2) at.set(seenTs[i], Number(seenTs[i + 1]));
  const hist = (kind: Reaction) =>
    Object.entries(react).filter(([, k]) => k === kind).map(([id]) => ({ id, at: at.get(id) ?? 0 })).sort((a, b) => b.at - a.at);
  const sorted = Array.from(profile, ([term, w]) => ({ term, w })).sort((a, b) => b.w - a.w);
  const first = seenTs.length ? Math.min(...Array.from(at.values())) : 0;
  return {
    uid,
    reactions: Number(meta.reactions ?? 0),
    counts: { like: Number(meta.n_like ?? 0), skip: Number(meta.n_skip ?? 0), save: Number(meta.n_save ?? 0), dive: Number(meta.n_dive ?? 0) },
    topTerms: sorted.filter((x) => x.w > 0).slice(0, 15),
    avoidTerms: sorted.filter((x) => x.w < 0).slice(-8).reverse(),
    saved,
    liked: hist("like"),
    skipped: hist("skip"),
    dived: hist("dive"),
    seen,
    lastVisit: Number(meta.lastVisit ?? 0),
    firstSeen: first,
    tasteWeight: Number(tw ?? 0),
  };
}

/**
 * Forget what the feed has learned: likes, passes, dives, the term profile, and the taste vector.
 * Reacted items are un-seen so they can come back; plain browse-seen items stay seen.
 * Saved items are never touched — they are the user's, not the model's.
 */
export async function resetTaste(uid: string): Promise<{ forgot: number }> {
  const r = redis();
  const react = await r.hgetall(UK.react(uid));
  const ids = Object.keys(react);
  const p = r.pipeline();
  if (ids.length) p.zrem(UK.seen(uid), ...ids);
  p.del(UK.react(uid), UK.profile(uid), EK.taste(uid), EK.tastew(uid));
  p.hdel(UK.meta(uid), "reactions", "n_like", "n_skip", "n_dive", "profileUpdatedAt");
  p.hincrby(UK.meta(uid), "resets", 1);
  await p.exec();
  return { forgot: ids.length };
}

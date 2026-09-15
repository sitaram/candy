/**
 * The single read API for every product surface (feed, voice, newsletter, ...).
 * Reads Redis only. Never calls GitHub or an LLM. Product code imports this and
 * nothing under store/, crawl/, or enrich/ directly.
 */
import { safeJson } from "../util/json";
import { CK, getCards, parseCard, type StoredCard } from "../enrich";
import type { Category, Flag, Hook } from "../enrich/card";
import { collectionMembers } from "../store/collections";
import { corpusIds, getRepos } from "../store/corpus";
import { parseRepo } from "../store/types";
import { K, normId } from "../store/keys";
import { getRaw } from "../store/raw";
import { redis } from "../store/redis";
import { currentVersion, readSnapshot, writeSnapshot } from "./snapshot";
import type { Mention, Repo } from "../store/types";

/** A repo with its card. The unit every interface works with. */
export interface Item {
  repo: Repo;
  card: StoredCard | null;
  sources: string[]; // hn, lobsters, rss, github, awesome, readme-link
  awesome: string[]; // awesome lists it belongs to
  priority: number;
}

/** Item + everything we know: for detail views, voice deep-dive, compare. */
export interface ItemDetail extends Item {
  readme: string;
  releases: Release[];
  mentions: Mention[];
  edges: {
    links: string[];
    alt: string[];
    buildsOn: string[];
    awesomeSiblings: string[];
  };
}

export interface Release {
  tag_name: string;
  name: string | null;
  published_at: string;
  prerelease: boolean;
  body: string | null;
}

export interface Filter {
  category?: Category | Category[];
  tag?: string | string[];
  hook?: Hook | Hook[];
  minInterest?: number;
  maxInterest?: number;
  excludeFlags?: Flag[]; // default: spam-suspect, no-substance
  language?: string;
  createdWithinDays?: number;
  releasedWithinDays?: number;
  source?: string;
  cardsOnly?: boolean; // default true
  exclude?: string[]; // ids already seen
  collection?: string; // niche collection name
}

export type Sort = "interest" | "velocity" | "released" | "priority" | "stars" | "created" | "random";

const DEFAULT_EXCLUDE: Flag[] = ["spam-suspect", "no-substance"];

/**
 * In-process read model. Served from the gzip'd snapshot (see snapshot.ts); the slow assembly path
 * runs only when no snapshot exists, and writes one. Version-checked every CHECK ms so a write
 * anywhere (crawl, ensureItem, backfill) is visible to every process within that window.
 */
let cache: { items: Item[]; ver: number; checkedAt: number; byId: Map<string, Item> } | null = null;
const CHECK = 30_000;
let loading: Promise<Item[]> | null = null;

export async function allItems(): Promise<Item[]> {
  if (cache && Date.now() - cache.checkedAt < CHECK) return cache.items;
  if (loading) return loading;
  loading = (async () => {
    try {
      if (cache) {
        const ver = await currentVersion();
        if (ver === cache.ver) { cache.checkedAt = Date.now(); return cache.items; }
      }
      const snap = await readSnapshot();
      if (snap) { cache = { items: snap.items, ver: snap.ver, checkedAt: Date.now(), byId: new Map(snap.items.map((i) => [i.repo.id, i])) }; return snap.items; }
      const items = await assembleItems();
      const ver = await writeSnapshot(items);
      cache = { items, ver, checkedAt: Date.now(), byId: new Map(items.map((i) => [i.repo.id, i])) };
      return items;
    } finally { loading = null; }
  })();
  return loading;
}

/** O(1) lookup for callers that have the id; avoids a linear find over the corpus. */
export async function itemById(id: string): Promise<Item | null> {
  await allItems();
  return cache?.byId.get(id) ?? null;
}

/** Slow path: assemble from per-repo keys. Only for building the snapshot. */
export async function assembleItems(): Promise<Item[]> {
  const ids = await corpusIds();
  const r = redis();
  const [repos, cards, prio, tagRes] = await Promise.all([
    getRepos(ids),
    getCards(ids),
    ids.length ? r.zmscore(K.frontier, ...ids) : Promise.resolve([] as (string | null)[]),
    r.pipeline(ids.map((id) => ["smembers", K.tags(id)])).exec(),
  ]);
  const prioById = new Map(ids.map((id, i) => [id, Number(prio[i] ?? 0)]));
  const tagsById = new Map(ids.map((id, i) => [id, (tagRes?.[i]?.[1] as string[]) ?? []]));
  return repos.map((repo) => {
    const tags = tagsById.get(repo.id) ?? [];
    return {
      repo,
      card: cards.get(repo.id) ?? null,
      sources: tags.filter((t) => t.startsWith("src:")).map((t) => t.slice(4)),
      awesome: tags.filter((t) => t.startsWith("awesome:")).map((t) => t.slice(8)),
      priority: prioById.get(repo.id) ?? 0,
    };
  });
}

/**
 * After a bulk write (crawl, enrich, embed scripts): rebuild the snapshot once so every process sees it.
 */
export async function invalidate(): Promise<void> {
  const items = await assembleItems();
  const ver = await writeSnapshot(items);
  cache = { items, ver, checkedAt: Date.now(), byId: new Map(items.map((i) => [i.repo.id, i])) };
}

/**
 * After a single-repo write (ensureItem, backfill): read that one repo back and patch it into the
 * snapshot. ~2 round trips instead of ~5k. Falls back to a full rebuild if there is no snapshot yet.
 */
export async function upsertSnapshotItem(id: string): Promise<void> {
  const nid = normId(id);
  // Always patch the *stored* snapshot, not the in-process cache: two processes (or two backfill
  // requests on one) each patching their own stale copy would have the second overwrite the first's
  // repo. Reading it back first narrows the window to the single write below; a full rebuild by any
  // crawl script closes it entirely. If the version moved while we worked, redo rather than clobber.
  for (let attempt = 0; attempt < 3; attempt++) {
    const [fresh, snap] = await Promise.all([readItemFromRedis(nid), readSnapshot()]);
    if (!snap) return invalidate();
    const items = snap.items.filter((i) => i.repo.id !== nid);
    if (fresh) items.push(fresh);
    if ((await currentVersion()) !== snap.ver) continue;         // someone wrote meanwhile; re-read
    const ver = await writeSnapshot(items);
    cache = { items, ver, checkedAt: Date.now(), byId: new Map(items.map((i) => [i.repo.id, i])) };
    return;
  }
  await invalidate();                                              // contended three times: rebuild from keys
}

async function readItemFromRedis(nid: string): Promise<Item | null> {
  const r = redis();
  const res = await r.pipeline().hgetall(K.repo(nid)).hgetall(CK.card(nid)).zscore(K.frontier, nid).smembers(K.tags(nid)).exec();
  const repo = parseRepo((res?.[0]?.[1] as Record<string, string>) ?? {});
  if (!repo) return null;
  const card = parseCard((res?.[1]?.[1] as Record<string, string>) ?? {});
  const tags = (res?.[3]?.[1] as string[]) ?? [];
  return {
    repo,
    card,
    sources: tags.filter((t) => t.startsWith("src:")).map((t) => t.slice(4)),
    awesome: tags.filter((t) => t.startsWith("awesome:")).map((t) => t.slice(8)),
    priority: Number(res?.[2]?.[1] ?? 0),
  };
}

function arr<T>(v: T | T[] | undefined): T[] | undefined {
  return v === undefined ? undefined : Array.isArray(v) ? v : [v];
}

export function matches(it: Item, f: Filter): boolean {
  const c = it.card;
  if ((f.cardsOnly ?? true) && !c) return false;
  if (f.exclude?.includes(it.repo.id)) return false;
  const ex = f.excludeFlags ?? DEFAULT_EXCLUDE;
  if (c && ex.some((fl) => c.flags.includes(fl))) return false;
  const cats = arr(f.category);
  if (cats && (!c || !cats.includes(c.category))) return false;
  const hooks = arr(f.hook);
  if (hooks && (!c || !hooks.includes(c.hook))) return false;
  const tags = arr(f.tag)?.map((t) => t.toLowerCase());
  if (tags && (!c || !tags.some((t) => c.tags.includes(t) || c.ecosystem.includes(t)))) return false;
  if (f.minInterest !== undefined && (c?.interest ?? -1) < f.minInterest) return false;
  if (f.maxInterest !== undefined && (c?.interest ?? 99) > f.maxInterest) return false;
  if (f.language && it.repo.language.toLowerCase() !== f.language.toLowerCase()) return false;
  if (f.source && !it.sources.includes(f.source)) return false;
  const now = Date.now();
  if (f.createdWithinDays !== undefined && now - Date.parse(it.repo.createdAt) > f.createdWithinDays * 86_400_000) return false;
  if (f.releasedWithinDays !== undefined) {
    if (!it.repo.latestReleaseAt || now - Date.parse(it.repo.latestReleaseAt) > f.releasedWithinDays * 86_400_000) return false;
  }
  return true;
}

export function sortItems(items: Item[], sort: Sort): Item[] {
  const s = [...items];
  switch (sort) {
    case "interest":
      return s.sort((a, b) => (b.card?.interest ?? -1) - (a.card?.interest ?? -1) || b.repo.starsPerDay - a.repo.starsPerDay);
    case "velocity":
      return s.sort((a, b) => b.repo.starsPerDay - a.repo.starsPerDay);
    case "released":
      return s.sort((a, b) => (b.repo.latestReleaseAt || "").localeCompare(a.repo.latestReleaseAt || ""));
    case "stars":
      return s.sort((a, b) => b.repo.stars - a.repo.stars);
    case "created":
      return s.sort((a, b) => b.repo.createdAt.localeCompare(a.repo.createdAt));
    case "random":
      for (let i = s.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [s[i], s[j]] = [s[j], s[i]];
      }
      return s;
    default:
      return s.sort((a, b) => b.priority - a.priority);
  }
}

export async function getItems(filter: Filter = {}, sort: Sort = "interest", limit = 50): Promise<Item[]> {
  let all = await allItems();
  if (filter.collection) {
    const members = new Set(await collectionMembers(filter.collection));
    all = all.filter((it) => members.has(it.repo.id));
  }
  return sortItems(all.filter((it) => matches(it, filter)), sort).slice(0, limit);
}

/**
 * One item, one Redis round trip. Serves from the corpus cache when warm; otherwise fetches just this
 * repo rather than loading all 1,200+ (which is ~1 s to a remote Redis, and was what every deep dive
 * paid whenever a backfill had invalidated the cache).
 */
export async function getItem(id: string): Promise<Item | null> {
  const nid = normId(id);
  const hit = cache?.byId.get(nid);
  if (hit) return hit;
  // Not in the snapshot: either never in the corpus, or written since. Ask Redis for just this one.
  return readItemFromRedis(nid);
}

export async function getItemDetail(id: string): Promise<ItemDetail | null> {
  const item = await getItem(id);
  if (!item) return null;
  const r = redis();
  const nid = item.repo.id;
  // Everything in one pipeline: this Redis is ~250 ms away, so round trips, not bytes, are the cost.
  const [readme, relRaw, mentionsRaw, links, alt, buildsOn] = await Promise.all([
    getRaw(nid, "readme"),
    getRaw(nid, "releases"),
    r.lrange(K.mentions(nid), 0, -1),
    r.smembers(K.edges(nid, "links")),
    r.smembers(CK.alt(nid)),
    r.smembers(CK.builds(nid)),
  ]);
  const mentions = mentionsRaw.map((x) => safeJson<Mention | null>(x, null, "mention")).filter((m): m is Mention => !!m);
  // Siblings: other corpus repos in the same awesome lists (capped). Tags already on the item.
  let awesomeSiblings: string[] = [];
  if (item.awesome.length) {
    const sets = (await r.pipeline(item.awesome.map((l) => ["sinter", K.awesome(l), K.corpus])).exec()) ?? [];
    awesomeSiblings = Array.from(new Set(sets.flatMap((x) => (x[1] as string[]) ?? []))).filter((x) => x !== nid).slice(0, 30);
  }
  return {
    ...item,
    readme,
    releases: safeJson<Release[]>(relRaw, [], "releases"),
    mentions,
    edges: { links, alt, buildsOn, awesomeSiblings },
  };
}

/**
 * Similar items by card overlap: shared tags/ecosystem weighted, same category,
 * explicit alt edges. Good enough until embeddings; same signature after.
 */
/**
 * Flat "similar" list, used by voice context and the /r page. Same ranker as the labelled groups
 * (related.ts), so the two never disagree; `why` is derived from the signals.
 */
export async function similar(id: string, limit = 10): Promise<{ item: Item; score: number; why: string[] }[]> {
  const { neighbors } = await import("./related");
  const ns = await neighbors(id, limit);
  return ns.map((n) => {
    const why: string[] = [];
    if (n.signals.alt) why.push("named alternative");
    if (n.signals.linksTo || n.signals.linkedFrom) why.push("linked from README");
    if (n.signals.sameOwner) why.push("same author");
    if (n.signals.shared.length) why.push(`shares ${n.signals.shared.slice(0, 3).join(", ")}`);
    if ((n.signals.cos ?? 0) > 0.6 && !why.length) why.push("close in meaning");
    if (n.signals.sameCategory && !why.length) why.push("same category");
    return { item: n.item, score: n.score, why };
  });
}

export async function categories(): Promise<{ category: string; count: number }[]> {
  const all = await allItems();
  const m = new Map<string, number>();
  for (const it of all) if (it.card) m.set(it.card.category, (m.get(it.card.category) ?? 0) + 1);
  return Array.from(m, ([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count);
}

/** Simple substring search over id, pitch, description, tags. Vector search later, same signature. */
export async function search(q: string, limit = 20): Promise<Item[]> {
  const needle = q.toLowerCase().trim();
  if (!needle) return [];
  const all = await allItems();
  const scored = all
    .map((it) => {
      const hay = [it.repo.id, it.repo.description, it.card?.pitch, it.card?.whyCare, ...(it.card?.tags ?? [])].join(" ").toLowerCase();
      let s = 0;
      if (it.repo.id.includes(needle)) s += 5;
      if (it.card?.tags.some((t) => t.includes(needle))) s += 3;
      if (hay.includes(needle)) s += 1;
      return { it, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || (b.it.card?.interest ?? 0) - (a.it.card?.interest ?? 0));
  return scored.slice(0, limit).map((x) => x.it);
}

export type { StoredCard } from "../enrich";
export type { Repo, Mention } from "../store/types";
export type { Category, Flag, Hook } from "../enrich/card";

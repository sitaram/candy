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

let cache: { at: number; items: Item[] } | null = null;
const TTL = 300_000;   // 5 min; invalidate() on any write (ensureItem), so staleness is only ever the crawl's

/** All items, cached 30s in-process. Cheap enough to scan for now (< 10k). */
export async function allItems(): Promise<Item[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.items;
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
  const items: Item[] = repos.map((repo) => {
    const tags = tagsById.get(repo.id) ?? [];
    return {
      repo,
      card: cards.get(repo.id) ?? null,
      sources: tags.filter((t) => t.startsWith("src:")).map((t) => t.slice(4)),
      awesome: tags.filter((t) => t.startsWith("awesome:")).map((t) => t.slice(8)),
      priority: prioById.get(repo.id) ?? 0,
    };
  });
  cache = { at: Date.now(), items };
  return items;
}

export function invalidate(): void {
  cache = null;
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
  if (cache && Date.now() - cache.at < TTL) return cache.items.find((it) => it.repo.id === nid) ?? null;
  const r = redis();
  const res = await r.pipeline().hgetall(K.repo(nid)).hgetall(CK.card(nid)).zscore(K.frontier, nid).smembers(K.tags(nid)).exec();
  const repo = parseRepo((res?.[0]?.[1] as Record<string, string>) ?? {});
  if (!repo) return null;
  const card = parseCard((res?.[1]?.[1] as Record<string, string>) ?? {});
  const tags = (res?.[3]?.[1] as string[]) ?? [];
  return {
    repo, card,
    sources: tags.filter((t) => t.startsWith("src:")).map((t) => t.slice(4)),
    awesome: tags.filter((t) => t.startsWith("awesome:")).map((t) => t.slice(8)),
    priority: Number(res?.[2]?.[1] ?? 0),
  };
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
export async function similar(id: string, limit = 10): Promise<{ item: Item; score: number; why: string[] }[]> {
  const me = await getItem(id);
  if (!me?.card) return [];
  const all = await allItems();
  const alt = new Set(await redis().smembers(CK.alt(me.repo.id)));
  const myTags = new Set([...me.card.tags, ...me.card.ecosystem].map((t) => t.toLowerCase()));
  const out: { item: Item; score: number; why: string[] }[] = [];
  for (const it of all) {
    if (it.repo.id === me.repo.id || !it.card) continue;
    const why: string[] = [];
    let score = 0;
    if (alt.has(it.repo.id)) {
      score += 5;
      why.push("named alternative");
    }
    if (it.card.category === me.card.category) {
      score += 2;
      why.push(`both ${it.card.category}`);
    }
    const shared = [...it.card.tags, ...it.card.ecosystem].map((t) => t.toLowerCase()).filter((t) => myTags.has(t));
    if (shared.length) {
      score += shared.length;
      why.push(`shares ${Array.from(new Set(shared)).slice(0, 3).join(", ")}`);
    }
    if (it.repo.language && it.repo.language === me.repo.language) score += 0.5;
    if (score >= 2) out.push({ item: it, score, why });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
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

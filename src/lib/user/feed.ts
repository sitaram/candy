import { allItems, getItem, type Item } from "../corpus/api";
import { rank, type Ranked } from "./rank";
import { getProfile, getSeen, react as reactState, touchVisit, type Reaction, UK } from "./state";
import { redis } from "../store/redis";

export interface FeedItem {
  id: string;
  score: number;
  fit: number;
  why: string[];
  explore: boolean;
  item: Item;
}

export interface Feed {
  items: FeedItem[];
  since: SinceLastVisit;
  profileSize: number;
}

export interface SinceLastVisit {
  lastVisit: number;
  newInCorpus: number;
  newInYourAreas: number;
  releasesOnSaved: { id: string; tag: string; at: string }[];
}

export async function feed(uid: string, n = 30, exclude: string[] = []): Promise<Feed> {
  const [items, profile, seen, visit] = await Promise.all([allItems(), getProfile(uid), getSeen(uid), touchVisit(uid)]);
  const ex = new Set([...seen, ...exclude]);
  const ranked: Ranked[] = rank(items, profile, { n, exclude: ex });
  const since = await sinceLastVisit(uid, items, visit.lastVisit, profile.size ? profile : null);
  return {
    items: ranked.map((r) => ({ id: r.item.repo.id, score: Math.round(r.score * 100) / 100, fit: Math.round(r.fit * 100) / 100, why: r.why, explore: r.explore, item: r.item })),
    since,
    profileSize: profile.size,
  };
}

async function sinceLastVisit(uid: string, items: Item[], lastVisit: number, profile: Map<string, number> | null): Promise<SinceLastVisit> {
  if (!lastVisit) return { lastVisit: 0, newInCorpus: 0, newInYourAreas: 0, releasesOnSaved: [] };
  const fresh = items.filter((it) => it.card && Date.parse(it.card.enrichedAt) > lastVisit);
  let newInYourAreas = 0;
  if (profile) {
    const topCats = new Set(Array.from(profile).filter(([k, v]) => k.startsWith("cat:") && v > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k.slice(4)));
    newInYourAreas = fresh.filter((it) => topCats.has(it.card!.category)).length;
  }
  const saved = await redis().zrange(UK.saved(uid), "0", "-1");
  const byId = new Map(items.map((it) => [it.repo.id, it]));
  const releasesOnSaved = saved
    .map((id) => byId.get(id))
    .filter((it): it is Item => !!it && !!it.repo.latestReleaseAt && Date.parse(it.repo.latestReleaseAt) > lastVisit)
    .map((it) => ({ id: it.repo.id, tag: it.repo.latestRelease, at: it.repo.latestReleaseAt }));
  return { lastVisit, newInCorpus: fresh.length, newInYourAreas, releasesOnSaved };
}

export async function react(uid: string, id: string, kind: Reaction): Promise<boolean> {
  const item = await getItem(id);
  if (!item) return false;
  await reactState(uid, item, kind);
  return true;
}

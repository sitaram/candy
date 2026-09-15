import { allItems, getItem, type Item } from "../corpus/api";
import { getEmbeddingsCached, tasteFrom } from "../embed";
import { rank, type Ranked } from "./rank";
import { loadUser, react as reactState, undo as undoState, unsave as unsaveState, type Action } from "./state";
import { redis } from "../store/redis";

export interface FeedItem {
  id: string;
  score: number;
  fit: number;
  why: string[];
  explore: boolean;
  saved: boolean;
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
  const [items, u] = await Promise.all([allItems(), loadUser(uid, { touch: true })]);
  const { profile, seen, saved } = u;
  const taste = tasteFrom(u.tasteBuf, u.tasteW);
  const ex = new Set([...seen, ...exclude]);
  // Only pull vectors when there is a taste to compare against (cold users rank on terms + base).
  const vectors = taste && taste.w > 0 ? await getEmbeddingsCached(items.filter((it) => it.card && !ex.has(it.repo.id)).map((it) => it.repo.id)) : undefined;
  const ranked: Ranked[] = rank(items, profile, { n, exclude: ex, taste, vectors });
  const since = sinceLastVisit(items, u.lastVisit, profile.size ? profile : null, saved);
  return {
    items: ranked.map((r) => ({
      id: r.item.repo.id,
      score: Math.round(r.score * 100) / 100,
      fit: Math.round(r.fit * 100) / 100,
      why: r.why,
      explore: r.explore,
      saved: saved.has(r.item.repo.id),
      item: r.item,
    })),
    since,
    profileSize: profile.size,
  };
}

function sinceLastVisit(items: Item[], lastVisit: number, profile: Map<string, number> | null, saved: Set<string>): SinceLastVisit {
  if (!lastVisit) return { lastVisit: 0, newInCorpus: 0, newInYourAreas: 0, releasesOnSaved: [] };
  const fresh = items.filter((it) => it.card && Date.parse(it.card.enrichedAt) > lastVisit);
  let newInYourAreas = 0;
  if (profile) {
    const topCats = new Set(Array.from(profile).filter(([k, v]) => k.startsWith("cat:") && v > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k.slice(4)));
    newInYourAreas = fresh.filter((it) => topCats.has(it.card!.category)).length;
  }
  const byId = new Map(items.map((it) => [it.repo.id, it]));
  const releasesOnSaved = Array.from(saved)
    .map((id) => byId.get(id))
    .filter((it): it is Item => !!it && !!it.repo.latestReleaseAt && Date.parse(it.repo.latestReleaseAt) > lastVisit)
    .map((it) => ({ id: it.repo.id, tag: it.repo.latestRelease, at: it.repo.latestReleaseAt }));
  return { lastVisit, newInCorpus: fresh.length, newInYourAreas, releasesOnSaved };
}

export async function act(uid: string, id: string, kind: Action): Promise<boolean> {
  const item = await getItem(id);
  if (!item) return false;
  if (kind === "unsave") await unsaveState(uid, item);
  else if (kind === "undo") return undoState(uid, item);
  else await reactState(uid, item, kind);
  return true;
}

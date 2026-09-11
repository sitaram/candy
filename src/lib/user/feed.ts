import { allItems, getItem, type Item } from "../corpus/api";
import { getEmbeddings, getTaste } from "../embed";
import { rank, type Ranked } from "./rank";
import { getProfile, getSeen, isSaved, react as reactState, touchVisit, undo as undoState, unsave as unsaveState, type Action, UK } from "./state";
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
  const [items, profile, seen, visit, taste] = await Promise.all([allItems(), getProfile(uid), getSeen(uid), touchVisit(uid), getTaste(uid)]);
  const ex = new Set([...seen, ...exclude]);
  // Only pull vectors when there is a taste to compare against (cold users rank on terms + base).
  const vectors = taste && taste.w > 0 ? await getEmbeddings(items.filter((it) => it.card && !ex.has(it.repo.id)).map((it) => it.repo.id)) : undefined;
  const ranked: Ranked[] = rank(items, profile, { n, exclude: ex, taste, vectors });
  const [since, saved] = await Promise.all([
    sinceLastVisit(uid, items, visit.lastVisit, profile.size ? profile : null),
    isSaved(uid, ranked.map((r) => r.item.repo.id)),
  ]);
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

export async function act(uid: string, id: string, kind: Action): Promise<boolean> {
  const item = await getItem(id);
  if (!item) return false;
  if (kind === "unsave") await unsaveState(uid, item);
  else if (kind === "undo") return undoState(uid, item);
  else await reactState(uid, item, kind);
  return true;
}

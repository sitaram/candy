/** Builders for the domain objects. Every field has a sane default; override what the test is about. */
import type { Item } from "@/lib/corpus/api";
import type { StoredCard } from "@/lib/enrich";
import type { Repo } from "@/lib/store/types";
import type { FeedItem } from "@/lib/user/feed";
import { DIM, normalize } from "@/lib/embed";

export const NOW = Date.parse("2026-09-14T12:00:00Z");
export const daysAgoIso = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

export function repo(over: Partial<Repo> & { id: string }): Repo {
  const [owner, name] = over.id.split("/");
  return {
    owner, name, url: `https://github.com/${over.id}`, description: "", homepage: "", language: "TypeScript", topics: [],
    license: "MIT", stars: 1000, forks: 10, openIssues: 1, watchers: 10, createdAt: daysAgoIso(400), pushedAt: daysAgoIso(1),
    archived: false, fork: false, defaultBranch: "main", sizeKb: 100, readmeLen: 1000, readmeHash: "h", manifestKind: "npm",
    depCount: 5, releaseCount: 3, latestRelease: "", latestReleaseAt: "", starsPerDay: 2, fetchedAt: daysAgoIso(0),
    ...over,
  } as Repo;
}

export function card(over: Partial<StoredCard> = {}): StoredCard {
  return {
    pitch: "A thing that does a job.", whyCare: "Because.", voice: "", category: "dev-tools", tags: ["cli"], audience: ["developers"],
    ecosystem: [], maturity: "usable", kind: "library", alternatives: [], buildsOn: [], hook: "none", interest: 5, flags: [], lang: "en",
    readmeHash: "h", model: "test", enrichedAt: daysAgoIso(0), inputTokens: 0, outputTokens: 0,
    ...over,
  };
}

export function item(id: string, over: { repo?: Partial<Repo>; card?: Partial<StoredCard> | null; sources?: string[]; awesome?: string[]; priority?: number } = {}): Item {
  return {
    repo: repo({ id, ...over.repo }),
    card: over.card === null ? null : card(over.card),
    sources: over.sources ?? ["github"],
    awesome: over.awesome ?? [],
    priority: over.priority ?? 1,
  };
}

export function feedItem(it: Item, over: Partial<FeedItem> = {}): FeedItem {
  return { id: it.repo.id, score: 1, fit: 0, why: [], explore: false, saved: false, item: it, ...over };
}

/** A unit vector with energy concentrated on one axis; two with the same axis have cos≈1, different axes cos≈0. */
export function vec(axis: number, spread = 0): Float32Array {
  const v = new Float32Array(DIM);
  v[axis % DIM] = 1;
  if (spread) for (let i = 1; i <= 8; i++) v[(axis + i) % DIM] = spread;
  return normalize(v);
}

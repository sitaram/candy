/**
 * Ranking: score = interest^1.2 × (1+fit) × recency × social, then a greedy
 * diversity pass with explore slots. Every term is a stored field, so every
 * result carries a human-readable `why[]`.
 */
import type { Item } from "../corpus/api";
import { itemTerms, type Profile } from "./state";

export interface Ranked {
  item: Item;
  score: number;
  fit: number;
  why: string[];
  explore: boolean;
}

const DAY = 86_400_000;

function ago(iso: string): string {
  const d = Math.round((Date.now() - Date.parse(iso)) / DAY);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}

/** Profile fit in [-0.5, 1]: matched positive weight vs. the profile's own top weights. */
export function fitScore(it: Item, profile: Profile): { fit: number; matched: string[] } {
  if (!profile.size) return { fit: 0, matched: [] };
  const top = Array.from(profile.values()).filter((v) => v > 0).sort((a, b) => b - a).slice(0, 5);
  const denom = top.reduce((a, b) => a + b, 0) || 1;
  let pos = 0;
  let neg = 0;
  const matched: { term: string; w: number }[] = [];
  for (const { term, w } of itemTerms(it)) {
    const p = profile.get(term);
    if (!p) continue;
    if (p > 0) {
      pos += p * w;
      matched.push({ term, w: p * w });
    } else neg += -p * w;
  }
  const fit = Math.max(-0.5, Math.min(1, pos / denom - neg / denom));
  return { fit, matched: matched.sort((a, b) => b.w - a.w).map((m) => m.term.replace(/^(cat|lang):/, "")) };
}

export function baseScore(it: Item): { score: number; why: string[] } {
  const c = it.card;
  const r = it.repo;
  const why: string[] = [];
  const interest = c?.interest ?? 3;
  let s = Math.pow(Math.max(0.5, interest), 1.2);

  // Recency: how fresh is the reason to look.
  const now = Date.now();
  const createdAge = (now - Date.parse(r.createdAt)) / DAY;
  const releaseAge = r.latestReleaseAt ? (now - Date.parse(r.latestReleaseAt)) / DAY : Infinity;
  const age = Math.min(createdAge, releaseAge);
  s *= 1 + 0.6 * Math.exp(-age / 7);

  if (c) {
    switch (c.hook) {
      case "major-release":
        s *= 1.2;
        if (r.latestRelease && releaseAge < 30) why.push(`released ${r.latestRelease} ${ago(r.latestReleaseAt)}`);
        break;
      case "viral":
        s *= 1.2;
        why.push(`${Math.round(r.starsPerDay).toLocaleString()} stars/day`);
        break;
      case "big-org":
        s *= 1.15;
        why.push(`from ${r.owner}`);
        break;
      case "license-change":
        s *= 1.3;
        why.push("license changed");
        break;
      case "novel-approach":
        s *= 1.1;
        why.push("novel approach");
        break;
      case "fills-gap":
        s *= 1.1;
        why.push("fills a gap");
        break;
      case "new-project":
        s *= 1.1;
        break;
    }
    if (createdAge < 14 && !why.some((w) => w.includes("stars/day"))) why.push(`new ${ago(r.createdAt)}, ${r.stars.toLocaleString()}★`);
    else if (releaseAge < 7 && !why.some((w) => w.startsWith("released"))) why.push(`released ${r.latestRelease} ${ago(r.latestReleaseAt)}`);
    if (interest >= 8 && why.length < 2) why.push("broadly notable");
  }

  // Social: independent humans pointed at it.
  const social = it.sources.filter((x) => x === "hn" || x === "lobsters" || x === "rss");
  if (social.length) {
    s *= 1 + 0.15 * social.length;
    const names = social.map((x) => (x === "hn" ? "Hacker News" : x === "lobsters" ? "Lobsters" : "a newsletter"));
    why.push(`on ${Array.from(new Set(names)).join(" and ")}`);
  }
  return { score: s, why };
}

export interface RankOpts {
  n: number;
  exploreRatio?: number; // default 0.2
  exclude?: Set<string>;
}

export function rank(items: Item[], profile: Profile, opts: RankOpts): Ranked[] {
  const exploreRatio = opts.exploreRatio ?? 0.2;
  const cands: Ranked[] = [];
  for (const it of items) {
    if (opts.exclude?.has(it.repo.id)) continue;
    if (!it.card) continue;
    if (it.card.flags.some((f) => f === "spam-suspect" || f === "no-substance" || f === "star-farm-suspect")) continue;
    const b = baseScore(it);
    const f = fitScore(it, profile);
    const why = [...b.why];
    if (f.matched.length) why.unshift(`matches your interest in ${Array.from(new Set(f.matched)).slice(0, 2).join(", ")}`);
    cands.push({ item: it, score: b.score * (1 + f.fit), fit: f.fit, why: why.slice(0, 3), explore: false });
  }

  // Greedy diversity pick. Penalize repeating categories and tag clusters.
  const picked: Ranked[] = [];
  const catCount = new Map<string, number>();
  const tagCount = new Map<string, number>();
  const pool = [...cands];
  const nExplore = profile.size ? Math.round(opts.n * exploreRatio) : 0;
  const nMain = opts.n - nExplore;

  const pickOne = (filter: (r: Ranked) => boolean) => {
    let best: Ranked | null = null;
    let bestAdj = -1;
    for (const r of pool) {
      if (!filter(r)) continue;
      const cat = r.item.card!.category;
      let adj = r.score * Math.pow(0.7, catCount.get(cat) ?? 0);
      const shared = r.item.card!.tags.filter((t) => (tagCount.get(t) ?? 0) > 0).length;
      if (shared >= 2) adj *= Math.pow(0.85, shared - 1);
      if (adj > bestAdj) {
        bestAdj = adj;
        best = r;
      }
    }
    if (!best) return false;
    pool.splice(pool.indexOf(best), 1);
    picked.push(best);
    const cat = best.item.card!.category;
    catCount.set(cat, (catCount.get(cat) ?? 0) + 1);
    for (const t of best.item.card!.tags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
    return true;
  };

  for (let i = 0; i < nMain; i++) if (!pickOne(() => true)) break;
  // Explore slots: good items the profile does not already like.
  for (let i = 0; i < nExplore; i++) {
    const ok = pickOne((r) => r.fit < 0.15 && (r.item.card?.interest ?? 0) >= 6);
    if (!ok) break;
    const last = picked[picked.length - 1];
    last.explore = true;
    last.why = ["outside your usual — exploring", ...last.why].slice(0, 3);
  }
  return picked;
}

/**
 * Ranking: score = interest^1.2 × (1+fit) × recency × social, then a greedy
 * diversity pass with explore slots. Every term is a stored field, so every
 * result carries a human-readable `why[]`.
 */
import type { Item } from "../corpus/api";
import { itemTerms, type Profile } from "./state";
import { readable } from "./terms";
import { dot, type Taste } from "../embed";

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
  // Readable, not the slug: "AI and LLM tools", "Rust" — this string is shown on the card and read aloud by voice.
  return { fit, matched: matched.sort((a, b) => b.w - a.w).map((m) => readable(m.term)) };
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
  /** Embedding side: the user's taste vector and the corpus vectors. Optional; falls back to terms alone. */
  taste?: Taste | null;
  vectors?: Map<string, Float32Array>;
}

/**
 * Taste fit from embeddings, in [-0.5, 1]. Cosine between unrelated cards is not 0 — it sits at
 * the corpus median — so center there and scale so the p99 pair reads ~1. `pnpm embed` prints
 * the corpus percentiles; update CENTER/SPAN if they drift. Confidence ramps with |weight| so the
 * first swipe does not swing the whole feed.
 */
// Measured on text-embedding-3-small @512 over 842 cards: p10 .239 · p50 .346 · p90 .514 · p99 .642.
// Nearest neighbours of a liked card reach .70–.78, so SPAN is set for p50 = 0 and cos .70 = 1: a
// random card scores 0, the p90 card ≈ 0.5, a true neighbour ≈ 1. p10 ≈ −0.3, clamped at −0.5.
const CENTER = 0.346, SPAN = 0.35;
/** 0..1: how much to trust the taste vector. Full weight after ~6 reactions' worth of evidence. */
export function tasteConfidence(taste: Taste | null | undefined): number {
  return taste && taste.w > 0 ? Math.min(1, taste.w / 6) : 0;
}

/**
 * Term fit and semantic fit, blended. The embedding's share ramps 0 → 60% with confidence, so the first like
 * doesn't drop term weight from 100% to 40% in one step. A card with no vector can't be compared; it gets the
 * term fit alone rather than a free 0 that outranks peers the taste actually dislikes.
 */
export function blendFit(termFit: number, v: Float32Array | undefined, taste: Taste | null | undefined): number {
  if (!v) return termFit;
  const conf = tasteConfidence(taste);
  if (!conf) return termFit;
  return termFit + conf * 0.6 * (tasteFit(v, taste) - termFit);
}

/** Raw semantic fit in −0.5..1, *not* confidence-scaled — rank() applies confidence to the blend weight instead. */
export function tasteFit(v: Float32Array | undefined, taste: Taste | null | undefined): number {
  if (!v || !taste || taste.w <= 0) return 0;
  const cos = dot(v, taste.v);
  return Math.max(-0.5, Math.min(1, (cos - CENTER) / SPAN));
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
    const v = opts.vectors?.get(it.repo.id);
    const t = v ? tasteFit(v, opts.taste) * tasteConfidence(opts.taste) : 0;   // for the "close to things you liked" line
    const fit = blendFit(f.fit, v, opts.taste);   // terms explain, embedding scores
    const why = [...b.why];
    if (f.matched.length) why.unshift(`matches your interest in ${Array.from(new Set(f.matched)).slice(0, 2).join(", ")}`);
    else if (t > 0.35) why.unshift("close to things you liked");
    cands.push({ item: it, score: b.score * (1 + fit), fit, why: why.slice(0, 3), explore: false });
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

  // Explore slots first: good items the profile does not already like. Reserve them before the main
  // pass, or the main pass (with its diversity bonus) takes the very items explore was meant to
  // surface, and the slot — and its "outside your usual" line — silently goes unused.
  const explore: Ranked[] = [];
  for (let i = 0; i < nExplore; i++) {
    const ok = pickOne((r) => r.fit < 0.15 && (r.item.card?.interest ?? 0) >= 6);
    if (!ok) break;
    const e = picked.pop()!;
    e.explore = true;
    e.why = ["outside your usual — exploring", ...e.why].slice(0, 3);
    explore.push(e);
  }
  for (let i = 0; i < nMain + (nExplore - explore.length); i++) if (!pickOne(() => true)) break;
  // Interleave: explore items land in the back half so the deck opens with the sure things.
  const out = [...picked];
  explore.forEach((e, i) => out.splice(Math.min(out.length, Math.floor(out.length / 2) + i * 2 + 1), 0, e));
  return out;
}

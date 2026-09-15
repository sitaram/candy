/**
 * Search: the feed with a query.
 *
 * Three retrievers over the same corpus, merged, then passed through the same personal ranker
 * the feed uses, so results come back as FeedItems with `why[]`:
 *
 *   name     prefix / substring on owner/name        — "playwright", "ollama"        instant
 *   keyword  tags, category, pitch, why-care          — "mcp server", "e2e testing"  instant
 *   semantic embed(query) · emb:{id}                  — "I want to build a voice agent that…"
 *
 * Semantic is the primary lane for anything that reads like intent; name/keyword add a boost
 * so an exact repo hit always tops its own query. Degrades to name+keyword when vectors are
 * absent or the embedding call fails. No LLM on the path; one embeddings call (~60 ms).
 */
import { allItems, type Item } from "../corpus/api";
import { embedTexts, getEmbeddingsCached, tasteFrom, dot } from "../embed";
import { baseScore, fitScore, blendFit, tasteFit, tasteConfidence } from "./rank";
import { loadUser } from "./state";
import type { FeedItem } from "./feed";

export interface SearchResult extends FeedItem {
  /** How this result was found; the UI shows the strongest as a chip. */
  match: "exact" | "name" | "keyword" | "semantic";
}

export interface SearchResponse {
  q: string;
  results: SearchResult[];
  /** Whether the semantic lane ran. False when vectors are absent or the embed call failed. */
  semantic: boolean;
  /** Set when q looks like owner/name or a bare name and we have exactly that repo. */
  exact: string | null;
}

const STOP = new Set("a an the i want to build build a for with that which what should use using of in on and or is it my me some something tool library framework app project thing things want need looking like best good".split(" "));

/** Keywords for the lexical lane: drop stop-words, keep 2+ char tokens, dedupe. */
export function keywords(q: string): string[] {
  return Array.from(new Set(q.toLowerCase().replace(/[^a-z0-9+#./ -]/g, " ").split(/\s+/).filter((t) => t.length >= 2 && !STOP.has(t))));
}

/** Does the query read like a repo reference? owner/name, or one token with no spaces. */
export function looksLikeName(q: string): boolean {
  const t = q.trim();
  return /^[\w.-]+\/[\w.-]+$/.test(t) || (/^[\w.-]+$/.test(t) && t.length >= 3);
}

interface Hit { it: Item; lex: number; sem: number; match: SearchResult["match"] }

/** Query→card cosine below this is not a match. Card↔card p50 is .346; a real concept query lands .45+. */
const SEM_FLOOR = 0.42;

export async function search(uid: string, qRaw: string, limit = 20, opts: { semantic?: boolean } = {}): Promise<SearchResponse> {
  const q = qRaw.trim();
  if (q.length < 2) return { q, results: [], semantic: false, exact: null };
  const ql = q.toLowerCase();
  const kws = keywords(q);
  const nameQuery = looksLikeName(q);

  // Start the OpenAI query embedding now so it overlaps the Redis reads instead of following them.
  // Only an explicit owner/name skips it: a bare word ("transcription", "observability") is as often a concept
  // as a repo name, and with no tag or text match it returned nothing. Exact/name hits still win on lex.
  const semanticWanted = (opts.semantic ?? true) && !/^[\w.-]+\/[\w.-]+$/.test(q);
  const qvP = semanticWanted ? queryVector(q).catch((e: unknown) => { console.warn("[search] embed", (e as Error).message); return null; }) : Promise.resolve(null);
  const [items, u] = await Promise.all([allItems(), loadUser(uid)]);
  const { profile, saved: savedAll } = u;
  const taste = tasteFrom(u.tasteBuf, u.tasteW);
  const carded = items.filter((it) => it.card && !it.card.flags.some((f) => f === "spam-suspect" || f === "no-substance" || f === "star-farm-suspect"));

  /* ---- lexical lane ---- */
  const hits = new Map<string, Hit>();
  let exact: string | null = null;
  for (const it of carded) {
    const id = it.repo.id.toLowerCase();
    const name = it.repo.name.toLowerCase();
    let lex = 0;
    let match: SearchResult["match"] = "keyword";
    if (id === ql || name === ql) { lex = 10; match = "exact"; exact = exact ?? it.repo.id; }
    else if (nameQuery && (name.startsWith(ql) || id.includes(ql))) { lex = 6; match = "name"; }
    else if (name.includes(ql)) { lex = 4; match = "name"; }
    if (kws.length) {
      const c = it.card!;
      const tags = c.tags.map((t) => t.toLowerCase());
      const lang = (it.repo.language ?? "").toLowerCase();
      const hay = `${c.pitch} ${c.whyCare} ${c.category} ${c.ecosystem.join(" ")} ${c.audience.join(" ")} ${it.repo.description}`.toLowerCase();
      let k = 0;
      for (const w of kws) {
        if (lang && lang === w) k += 2;
        else if (tags.some((t) => t === w)) k += 2;
        else if (tags.some((t) => t.includes(w))) k += 1.2;
        else if (hay.includes(w)) k += 0.6;
      }
      // Fraction of keywords matched matters more than raw count for multi-word intents.
      const frac = k / (2 * kws.length);
      if (frac > 0) { lex = Math.max(lex, 3 * frac); if (match === "keyword" && lex < 3) match = "keyword"; }
    }
    if (lex > 0) hits.set(it.repo.id, { it, lex, sem: 0, match });
  }

  /* ---- semantic lane ---- */
  let semantic = false;
  const qv = await qvP;
  if (qv) {
    try {
      const vectors = await getEmbeddingsCached(carded.map((it) => it.repo.id));
      if (vectors.size > 0) {
        semantic = true;
        const scored: { it: Item; cos: number }[] = [];
        for (const it of carded) {
          const v = vectors.get(it.repo.id);
          if (v) scored.push({ it, cos: dot(qv, v) });
        }
        scored.sort((a, b) => b.cos - a.cos);
        // Take the top band; below the 40th result or a cosine gap of 0.12 from the best, it's noise.
        // And an absolute floor: semRel is relative to the best hit, so without this a nonsense query's
        // best-of-a-bad-lot (cos .3) came back as a confident "close to what you described".
        const best = scored[0]?.cos ?? 0;
        for (const s of scored.slice(0, 40)) {
          if (s.cos < best - 0.12 || s.cos < SEM_FLOOR) break;
          const h = hits.get(s.it.repo.id);
          if (h) h.sem = s.cos;
          else hits.set(s.it.repo.id, { it: s.it, lex: 0, sem: s.cos, match: "semantic" });
        }
      }
    } catch (e) {
      console.warn("[search] semantic lane skipped:", (e as Error).message);
    }
  }
  if (!hits.size) return { q, results: [], semantic, exact: null };

  /* ---- merge + personal ranking ---- */
  const ids = Array.from(hits.keys());
  const tasteVectors = taste && taste.w > 0 ? await getEmbeddingsCached(ids) : undefined;
  const bestSem = Math.max(...Array.from(hits.values()).map((h) => h.sem), 0.0001);
  const ranked = Array.from(hits.values()).map((h) => {
    // Relevance in [0,1]. Exact/name hits saturate. Otherwise semantic finds and lexical confirms:
    // a candidate the embedding likes *and* that says "rust" / "cli" outranks one the embedding
    // merely likes — cosine over short queries is noisy about language and form factor.
    const semRel = h.sem / bestSem;
    const lexRel = Math.min(1, h.lex / 3);
    const rel = h.lex >= 4 ? 1 : h.sem > 0 ? 0.7 * semRel + 0.3 * lexRel : 0.6 * lexRel;
    const b = baseScore(h.it);
    const f = fitScore(h.it, profile);
    const v = tasteVectors?.get(h.it.repo.id);
    const t = v ? tasteFit(v, taste) * tasteConfidence(taste) : 0;
    const fit = blendFit(f.fit, v, taste);
    // Relevance dominates; quality and fit break ties and reorder near-equals.
    const score = rel * rel * Math.pow(b.score, 0.35) * (1 + 0.5 * fit);
    // Which lane carried it: an exact/name hit, a strong keyword hit, or the embedding.
    const semLed = h.sem > 0 && h.sem / bestSem > Math.min(1, h.lex / 6);
    const match: SearchResult["match"] = h.match === "exact" || h.match === "name" ? h.match : semLed ? "semantic" : "keyword";
    const why: string[] = [];
    if (match === "exact") why.push("exact match");
    else if (match === "name") why.push("name matches");
    else if (match === "semantic") why.push("close to what you described");
    else why.push(`matches "${kws.slice(0, 2).join(" ")}"`);
    if (f.matched.length) why.push(`matches your interest in ${Array.from(new Set(f.matched)).slice(0, 2).join(", ")}`);
    else if (t > 0.35) why.push("close to things you liked");
    why.push(...b.why.filter((w) => !/^broadly/.test(w)).slice(0, 1));
    return { h, match, score, fit, why: why.slice(0, 3) };
  });
  ranked.sort((a, b) => b.score - a.score);
  const top = ranked.slice(0, limit);
  const saved = savedAll;

  return {
    q,
    semantic,
    exact,
    results: top.map((r) => ({
      id: r.h.it.repo.id,
      score: Math.round(r.score * 100) / 100,
      fit: Math.round(r.fit * 100) / 100,
      why: r.why,
      explore: false,
      saved: saved.has(r.h.it.repo.id),
      item: r.h.it,
      match: r.match,
    })),
  };
}

/**
 * Query embeddings, cached. The same few hundred queries recur ("mcp server", "rust cli"), and voice
 * search repeats its last query on every re-render of the sheet. OpenAI round trip is ~150 ms and
 * $0.00002; the cache makes repeats 0 ms. Bounded LRU of 500 ≈ 1 MB.
 */
const qcache = new Map<string, Float32Array>();
async function queryVector(q: string): Promise<Float32Array> {
  const k = q.trim().toLowerCase();
  const hit = qcache.get(k);
  if (hit) { qcache.delete(k); qcache.set(k, hit); return hit; }
  const [v] = await embedTexts([k], "query");
  qcache.set(k, v);
  if (qcache.size > 500) qcache.delete(qcache.keys().next().value!);
  return v;
}
